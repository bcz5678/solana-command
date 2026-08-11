// ============================================================================
// app/api/dev/site-actions/route.ts
//
// POST /api/dev/site-actions
//
// Dev-only recovery actions. Wraps the RPCs that scripts/reset-site.ts calls,
// so a stuck state can be cleared from the wizard instead of dropping into a
// terminal — which matters when the wizard is the thing being tested.
//
// THREE GATES, deliberately redundant:
//
//   1. NODE_ENV — this route 404s in production
//   2. Super admin — checked inside each RPC via private.is_super_admin_db()
//   3. app.environment — the reset/rewind functions refuse when it is
//      'production', regardless of how they were reached
//
// The third is the one that matters: it lives in the database, so it holds even
// if this route were somehow deployed.
// ============================================================================

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Action =
  | "reset_provisioning"
  | "rewind_provisioning"
  | "unblock_provisioning"
  | "release_domain_claim"
  | "reset_builds"
  | "reset_site_full"
  | "discard_draft_site"
  | "cancel_runs";

interface ActionBody {
  action: Action;
  siteId: string;
  /** rewind_provisioning */
  fromStep?: string;
  /** reset_provisioning — false also clears sites.domain */
  keepDomain?: boolean;
  /** reset_builds — false also deletes site_versions */
  keepVersions?: boolean;
}

export async function POST(req: NextRequest) {
  // Gate 1. Returns 404 rather than 403: a route that should not exist in
  // production should not announce itself either.
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const supabase = await createClient();

  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: ActionBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!body.siteId) {
    return NextResponse.json({ error: "siteId is required" }, { status: 400 });
  }

  // Captured BEFORE the action, so the AWS cleanup notice can name resources
  // the RPC is about to null out.
  const { data: before } = await supabase
    .from("sites")
    .select("id, name, domain, s3_prefix, provisioning_status, cert_arn, distribution_id")
    .eq("id", body.siteId)
    .single();

  let result: unknown;
  let error: { message: string } | null = null;

  switch (body.action) {
    case "reset_provisioning":
      ({ data: result, error } = await supabase.rpc("reset_provisioning", {
        p_site_id: body.siteId,
        p_keep_domain: body.keepDomain ?? true,
      }));
      break;

    case "rewind_provisioning":
      if (!body.fromStep) {
        return NextResponse.json({ error: "fromStep is required" }, { status: 400 });
      }
      ({ data: result, error } = await supabase.rpc("rewind_provisioning", {
        p_site_id: body.siteId,
        p_from_step: body.fromStep,
      }));
      break;

    case "unblock_provisioning":
      ({ data: result, error } = await supabase.rpc("unblock_provisioning", {
        p_site_id: body.siteId,
      }));
      break;

    case "release_domain_claim":
      ({ data: result, error } = await supabase.rpc("release_domain_claim", {
        p_site_id: body.siteId,
      }));
      break;

    case "reset_builds":
      ({ data: result, error } = await supabase.rpc("reset_builds", {
        p_site_id: body.siteId,
        p_keep_versions: body.keepVersions ?? true,
      }));
      break;

    case "reset_site_full":
      ({ data: result, error } = await supabase.rpc("reset_site_full", {
        p_site_id: body.siteId,
      }));
      break;

    case "discard_draft_site":
      ({ data: result, error } = await supabase.rpc("discard_draft_site", {
        p_site_id: body.siteId,
      }));
      break;

    // Clears provisioning_runs_one_active_per_site_kind without touching
    // events — the surgical fix for "a run is already in progress" when the
    // run is actually dead and the reaper has not caught up.
    case "cancel_runs":
      ({ data: result, error } = await supabase.rpc("reset_provisioning", {
        p_site_id: body.siteId,
        p_keep_domain: true,
      }));
      break;

    default:
      return NextResponse.json(
        { error: `Unknown action "${body.action}"` },
        { status: 400 },
      );
  }

  if (error) {
    const message = error.message ?? "";

    if (message.includes("disabled in production")) {
      return NextResponse.json(
        {
          error: "Database helpers are disabled — app.environment is 'production'.",
          hint: "If this is a development database: alter database postgres reset app.environment;",
        },
        { status: 403 },
      );
    }

    if (message.includes("requires super admin")) {
      return NextResponse.json(
        {
          error: "Your account is not an active super admin.",
          hint: "Check: select * from private.super_admins;",
        },
        { status: 403 },
      );
    }

    // "site is provisioned — use teardown", "not a draft", etc. Well-formed
    // request, wrong site state.
    if (message.includes("use teardown") || message.includes("is not a draft")) {
      return NextResponse.json({ error: message }, { status: 422 });
    }

    console.error(`[dev/site-actions] ${body.action} failed:`, message);
    return NextResponse.json({ error: message }, { status: 500 });
  }

  // ---- AWS cleanup ----
  //
  // The part people skip, and the one that produces the confusing failure:
  // CloudFront rejects a duplicate CNAME across the whole account, so a
  // leftover alias blocks re-adding the domain even to the same distribution —
  // and the next run fails at distribution_configure with what looks like a
  // permissions error.
  const cleanup: Array<{ label: string; command: string }> = [];

  const touchesAws = [
    "reset_provisioning",
    "reset_site_full",
    "discard_draft_site",
  ].includes(body.action);

  if (touchesAws && before?.distribution_id && before?.domain) {
    cleanup.push({
      label: `Remove alias "${before.domain}" from distribution ${before.distribution_id}`,
      command:
        `aws cloudfront get-distribution-config --id ${before.distribution_id} > /tmp/dist.json\n` +
        `# edit /tmp/dist.json: drop "${before.domain}" from Aliases.Items, decrement Quantity,\n` +
        `# and revert ViewerCertificate to CloudFrontDefaultCertificate if it points at the cert below\n` +
        `jq '.DistributionConfig' /tmp/dist.json > /tmp/config.json\n` +
        `aws cloudfront update-distribution --id ${before.distribution_id} \\\n` +
        `  --distribution-config file:///tmp/config.json \\\n` +
        `  --if-match $(jq -r '.ETag' /tmp/dist.json)`,
    });
  }

  if (touchesAws && before?.cert_arn) {
    cleanup.push({
      label: "Delete the certificate (after removing the alias)",
      command:
        `aws acm delete-certificate --region us-east-1 \\\n` +
        `  --certificate-arn ${before.cert_arn}`,
    });
  }

  return NextResponse.json(
    {
      action: body.action,
      site: before,
      result,
      awsCleanup: cleanup,
    },
    { status: 200 },
  );
}