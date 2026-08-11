// ============================================================================
// app/api/dev/sites/route.ts
//
// GET  /api/dev/sites   — every site with the state needed to decide what to prune
// POST /api/dev/sites   — bulk action across selected sites
//
// Dev-only. Three gates, deliberately redundant:
//   1. NODE_ENV — 404s in production
//   2. Super admin — checked inside each RPC
//   3. app.environment — the reset functions refuse when it is 'production'
//
// The third lives in the database, so it holds even if this route shipped.
// ============================================================================

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Bulk actions run sequentially; twenty sites at a few hundred ms each.
export const maxDuration = 120;

// ============================================================================
// TYPES
// ============================================================================

export type BulkAction =
  | "cancel_runs"
  | "release_domain_claim"
  | "unblock_provisioning"
  | "reset_provisioning"
  | "reset_builds"
  | "reset_site_full"
  | "discard_draft_site"
  |  "force_draft_site"
  |  "force_discard_site"

interface SiteRow {
  id: string;
  name: string;
  token_symbol: string | null;
  domain: string | null;
  domain_source: string | null;
  domain_released_at: string | null;
  s3_prefix: string | null;
  provisioning_status: string;
  distribution_id: string | null;
  cert_arn: string | null;
  published_at: string | null;
  is_archived: boolean;
  created_at: string;
  updated_at: string;
}

// ============================================================================
// GET — inventory
// ============================================================================

export async function GET(req: NextRequest) {
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const supabase = await createClient();

  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const includeArchived =
    new URL(req.url).searchParams.get("includeArchived") === "true";

  const { data: sites, error } = await supabase.rpc("list_sites_admin", {
    p_include_archived: includeArchived,
  });

  if (error) {
    console.error("[dev/sites] list failed:", error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const rows = (sites ?? []) as unknown as SiteRow[];

  // Active run state, so the table can show what is stuck without a second
  // request per row.
  const { data: runs } = await supabase.rpc("active_runs_admin");

  const runsBySite = new Map<string, unknown[]>();
  for (const run of (runs ?? []) as unknown as Array<{ site_id: string }>) {
    const list = runsBySite.get(run.site_id) ?? [];
    list.push(run);
    runsBySite.set(run.site_id, list);
  }

  return NextResponse.json(
    {
      sites: rows.map((s) => ({
        ...s,
        activeRuns: runsBySite.get(s.id) ?? [],
        applicable: applicableActions(s, runsBySite.get(s.id) ?? []),
        flags: flagsFor(s, runsBySite.get(s.id) ?? []),
      })),
    },
    { status: 200, headers: { "Cache-Control": "no-store" } },
  );
}

/**
 * Which actions make sense for this site.
 *
 * Computed server-side so the table can grey out the rest — a bulk action
 * across a selection spanning a live site and three drafts should not silently
 * do different things to each.
 */
function applicableActions(site: SiteRow, activeRuns: unknown[]): BulkAction[] {
  const out: BulkAction[] = [];
  const isDraft = site.provisioning_status === "draft";
  const isReady = site.provisioning_status === "ready";

  if (activeRuns.length > 0) out.push("cancel_runs");

  const blocked = (activeRuns as Array<{ status?: string }>).some(
    (r) => r.status === "blocked",
  );
  if (blocked) out.push("unblock_provisioning");

  // Clearing the domain on a provisioned site would strand its CloudFront
  // alias and certificate — that path is teardown.
  if (site.domain && !isReady) out.push("release_domain_claim");


  // Recovery for a stuck site, before the resets — demoting to draft makes the
  // ordinary path work again, which is usually all that is needed.
  if (!isDraft && !isReady) out.push("force_draft_site");

  // Deleting a clean draft is less destructive than resetting it.
  if (isDraft && !site.published_at) out.push("discard_draft_site");

  out.push("reset_provisioning", "reset_builds", "reset_site_full");

  // A draft has no AWS resources, so deleting the row leaves nothing behind.
  if (isDraft && !site.published_at) out.push("discard_draft_site");

  return [...new Set(out)];
}

/** Why a site might want attention. Drives the table's filter chips. */
function flagsFor(site: SiteRow, activeRuns: unknown[]): string[] {
  const flags: string[] = [];
  const ageDays = (Date.now() - new Date(site.updated_at).getTime()) / 86_400_000;

  if ((activeRuns as Array<{ status?: string }>).some((r) => r.status === "blocked")) {
    flags.push("blocked");
  }

  if (activeRuns.length > 0) flags.push("running");

  if (site.provisioning_status === "draft" && ageDays > 7) {
    flags.push("stale-draft");
  }

  // Provisioning left resources behind but the site is not live — the usual
  // aftermath of a failed or reset run, and the main thing to prune.
  if (site.provisioning_status !== "ready" && (site.cert_arn || site.distribution_id)) {
    flags.push("orphaned-aws");
  }

  if (site.provisioning_status === "ready" && !site.published_at) {
    flags.push("provisioned-unpublished");
  }

  if (site.domain_released_at) flags.push("domain-released");

  return flags;
}

// ============================================================================
// POST — bulk action
// ============================================================================

interface BulkBody {
  action: BulkAction;
  siteIds: string[];
}

const RPC_FOR: Record<BulkAction, { fn: string; args: (id: string) => Record<string, unknown> }> = {
  cancel_runs:          { fn: "reset_provisioning",   args: (id) => ({ p_site_id: id, p_keep_domain: true }) },
  release_domain_claim: { fn: "release_domain_claim", args: (id) => ({ p_site_id: id }) },
  unblock_provisioning: { fn: "unblock_provisioning", args: (id) => ({ p_site_id: id }) },
  reset_provisioning:   { fn: "reset_provisioning",   args: (id) => ({ p_site_id: id, p_keep_domain: true }) },
  reset_builds:         { fn: "reset_builds",         args: (id) => ({ p_site_id: id, p_keep_versions: true }) },
  reset_site_full:      { fn: "reset_site_full",      args: (id) => ({ p_site_id: id }) },
  discard_draft_site:   { fn: "discard_draft_site",   args: (id) => ({ p_site_id: id }) },
  force_draft_site:   { fn: "force_draft_site",   args: (id) => ({ p_site_id: id }) },
  force_discard_site: { fn: "force_discard_site", args: (id) => ({ p_site_id: id, p_aws_cleaned_up: true }) },
};

export async function POST(req: NextRequest) {
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const supabase = await createClient();

  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: BulkBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!RPC_FOR[body.action]) {
    return NextResponse.json({ error: `Unknown action "${body.action}"` }, { status: 400 });
  }

  if (!Array.isArray(body.siteIds) || body.siteIds.length === 0) {
    return NextResponse.json({ error: "siteIds is required" }, { status: 400 });
  }

  if (body.siteIds.length > 50) {
    return NextResponse.json(
      { error: "Refusing more than 50 sites in one action" },
      { status: 400 },
    );
  }

  // Captured BEFORE acting: the RPCs null out cert_arn and distribution_id, so
  // the cleanup script has to be built from the prior state.
  const { data: beforeRows } = await supabase.rpc("list_sites_admin", {
    p_include_archived: true,
  });

  const before = new Map(
    ((beforeRows ?? []) as unknown as SiteRow[]).map((s) => [s.id, s]),
  );

  const spec = RPC_FOR[body.action];
  const results: Array<{
    siteId: string;
    name: string;
    ok: boolean;
    result?: unknown;
    error?: string;
  }> = [];

  // Sequential, not Promise.all. Several of these take row locks on the same
  // tables, and a partial failure is easier to reason about in order.
  for (const siteId of body.siteIds) {
    const site = before.get(siteId);

    const { data, error } = await supabase.rpc(spec.fn, spec.args(siteId));

    results.push({
      siteId,
      name: site?.name ?? siteId,
      ok: !error,
      result: data,
      error: error?.message,
    });
  }

  // ---- Aggregated cleanup ----
  const touchesAws = [
    "reset_provisioning", 
    "reset_site_full", 
    "discard_draft_site",
    "force_draft_site",
    "force_discard_site",
  ].includes(body.action);

  const cleanup = touchesAws
    ? buildCleanupScript(
        results.filter((r) => r.ok).map((r) => before.get(r.siteId)).filter(Boolean) as SiteRow[],
      )
    : null;

  return NextResponse.json(
    {
      action: body.action,
      succeeded: results.filter((r) => r.ok).length,
      failed: results.filter((r) => !r.ok).length,
      results,
      cleanupScript: cleanup,
    },
    { status: 200 },
  );
}

// ============================================================================
// CLEANUP SCRIPT
// ============================================================================

/**
 * One runnable bash script covering every affected site.
 *
 * Sixteen commands pasted one at a time do not get run; a single script does.
 * And skipping cleanup produces the confusing failure — CloudFront rejects a
 * duplicate CNAME across the whole account, so a leftover alias blocks the
 * domain from being re-added even to the same distribution, and the next run
 * fails at distribution_configure with what reads like a permissions error.
 */
function buildCleanupScript(sites: SiteRow[]): string | null {
  const needsWork = sites.filter((s) => s.cert_arn || (s.distribution_id && s.domain));
  if (needsWork.length === 0) return null;

  const lines: string[] = [
    "#!/usr/bin/env bash",
    "#",
    "# Generated AWS cleanup. Requires: aws cli, jq.",
    "#",
    "# The database rows are already reset. These AWS resources are not — and a",
    "# leftover CloudFront alias blocks the domain from being re-added ANYWHERE",
    "# in the account, so the next provisioning run would fail at",
    "# distribution_configure with what looks like a permissions error.",
    "#",
    `# ${needsWork.length} site(s), generated ${new Date().toISOString()}`,
    "",
    "set -euo pipefail",
    "",
    'TMP=$(mktemp -d)',
    'trap "rm -rf $TMP" EXIT',
    "",
  ];

  // Group by distribution: several sites can share one, and each needs a
  // single update removing all their aliases rather than one call per site
  // racing on the ETag.
  const byDistribution = new Map<string, SiteRow[]>();
  for (const site of needsWork) {
    if (!site.distribution_id || !site.domain) continue;
    const list = byDistribution.get(site.distribution_id) ?? [];
    list.push(site);
    byDistribution.set(site.distribution_id, list);
  }

  for (const [distributionId, group] of byDistribution) {
    const domains = group.map((s) => s.domain!).filter(Boolean);

    lines.push(
      `# ---------------------------------------------------------------`,
      `# ${distributionId} — remove ${domains.length} alias(es)`,
      `#   ${group.map((s) => `${s.name} (${s.domain})`).join("\n#   ")}`,
      `# ---------------------------------------------------------------`,
      `aws cloudfront get-distribution-config --id ${distributionId} > "$TMP/${distributionId}.json"`,
      `ETAG=$(jq -r '.ETag' "$TMP/${distributionId}.json")`,
      "",
      `jq '.DistributionConfig`,
      `   | .Aliases.Items = ((.Aliases.Items // []) - ${JSON.stringify(domains)})`,
      `   | .Aliases.Quantity = (.Aliases.Items | length)`,
      // A distribution with no aliases cannot keep a custom cert scoped to them.
      `   | if (.Aliases.Quantity == 0)`,
      `     then .ViewerCertificate = {"CloudFrontDefaultCertificate": true, "MinimumProtocolVersion": "TLSv1", "CertificateSource": "cloudfront"}`,
      `     else . end' \\`,
      `  "$TMP/${distributionId}.json" > "$TMP/${distributionId}-config.json"`,
      "",
      `aws cloudfront update-distribution --id ${distributionId} \\`,
      `  --distribution-config "file://$TMP/${distributionId}-config.json" \\`,
      `  --if-match "$ETAG"`,
      "",
      `echo "Waiting for ${distributionId} to deploy before deleting certificates..."`,
      `aws cloudfront wait distribution-deployed --id ${distributionId}`,
      "",
    );
  }

  const certs = needsWork.map((s) => s.cert_arn).filter(Boolean) as string[];

  if (certs.length > 0) {
    lines.push(
      `# ---------------------------------------------------------------`,
      `# Certificates — ${certs.length}`,
      `#`,
      `# Must follow the alias removal above: ACM refuses to delete a cert that`,
      `# is still attached, and CloudFront needs to finish deploying first.`,
      `# ---------------------------------------------------------------`,
    );

    for (const arn of [...new Set(certs)]) {
      lines.push(
        `aws acm delete-certificate --region us-east-1 --certificate-arn ${arn} \\`,
        `  || echo "  could not delete ${arn} — still attached?"`,
      );
    }
    lines.push("");
  }

  lines.push(
    `# Not needed:`,
    `#   Namecheap host records — setHosts REPLACES the full set on the next run`,
    `#   S3 prefixes            — the build overwrites index.html; media is hashed`,
    "",
    `echo "Cleanup complete."`,
    "",
  );

  return lines.join("\n");
}