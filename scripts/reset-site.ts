// ============================================================================
// scripts/reset-site.ts
//
// Wipes provisioning and/or build state for a site so a workflow can be
// re-run from scratch, or from a specific step.
//
//   pnpm tsx scripts/reset-site.ts <site>                      # provisioning only
//   pnpm tsx scripts/reset-site.ts <site> --full               # + builds + versions
//   pnpm tsx scripts/reset-site.ts <site> --from cert_request  # replay one step onward
//   pnpm tsx scripts/reset-site.ts <site> --unblock            # clear a block only
//   pnpm tsx scripts/reset-site.ts <site> --builds             # builds only
//   pnpm tsx scripts/reset-site.ts <site> --drop-domain        # also clear the domain
//   pnpm tsx scripts/reset-site.ts <site> --yes                # skip confirmation
//
// <site> is a site UUID, or a domain, or an s3_prefix — whichever you have to
// hand. Retyping a UUID is how you reset the wrong site.
//
// ############################################################################
// #  DATABASE RESET IS NOT AWS RESET.                                        #
// #                                                                          #
// #  This wipes rows so the plan re-runs every step. It does NOT delete the  #
// #  ACM certificate or remove the CloudFront alias from the previous run.   #
// #                                                                          #
// #  The alias is the one that bites: CloudFront rejects a duplicate CNAME   #
// #  ACROSS THE ACCOUNT, so a leftover alias blocks re-adding it even to the #
// #  same distribution — and the re-run fails at distribution_configure with #
// #  an error that reads like a permissions problem.                         #
// #                                                                          #
// #  This script prints the exact cleanup commands. Run them.                #
// ############################################################################
// ============================================================================

import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";

// ============================================================================
// ARGS
// ============================================================================

const args = process.argv.slice(2);
const target = args[0];

if (!target || target.startsWith("--")) {
  console.error(`
Usage: reset-site.ts <site-uuid|domain|s3-prefix> [options]

  --full            provisioning + builds + versions
  --builds          builds only
  --from <step>     replay from this step onward (rewind)
  --unblock         clear a blocked run without wiping history
  --drop-domain     also clear sites.domain
  --yes             skip the confirmation prompt
`);
  process.exit(1);
}

const FULL        = args.includes("--full");
const BUILDS_ONLY = args.includes("--builds");
const UNBLOCK     = args.includes("--unblock");
const DROP_DOMAIN = args.includes("--drop-domain");
const SKIP_CONFIRM = args.includes("--yes");
const FROM_STEP   = argValue("--from");

function argValue(flag: string): string | undefined {
  const i = args.indexOf(flag);
  return i === -1 ? undefined : args[i + 1];
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing environment variable: ${name}`);
  return value;
}

// ============================================================================
// CLIENT
// ============================================================================

/**
 * Signs in as a super admin rather than using the service key.
 *
 * The reset functions gate on private.is_super_admin_db(), which reads
 * auth.uid(). A service_role client has no auth.uid(), so the gate fails
 * closed — and service_role is a much wider credential than one admin session.
 */
async function adminSession(): Promise<SupabaseClient> {
  const supabase = createClient(
    requireEnv("SUPABASE_URL"),
    requireEnv("SUPABASE_ANON_KEY"),
    { auth: { persistSession: false } },
  );

  const { error } = await supabase.auth.signInWithPassword({
    email: requireEnv("ADMIN_EMAIL"),
    password: requireEnv("ADMIN_PASSWORD"),
  });

  if (error) throw new Error(`admin sign-in failed: ${error.message}`);
  return supabase;
}

// ============================================================================
// RESOLUTION
// ============================================================================

interface SiteRow {
  id: string;
  name: string;
  domain: string | null;
  s3_prefix: string | null;
  provisioning_status: string;
  cert_arn: string | null;
  distribution_id: string | null;
  published_version_id: string | null;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Accept a UUID, a domain, or an s3_prefix.
 *
 * Reading a UUID off a dashboard and retyping it is how you reset the wrong
 * site — and with short-lived event sites there are usually several in flight
 * at once.
 */
async function resolveSite(supabase: SupabaseClient, input: string): Promise<SiteRow> {
  const columns =
    "id, name, domain, s3_prefix, provisioning_status, cert_arn, distribution_id, published_version_id";

  if (UUID_RE.test(input)) {
    const { data, error } = await supabase
      .from("sites").select(columns).eq("id", input).single();
    if (error || !data) throw new Error(`No site with id ${input}`);
    return data as SiteRow;
  }

  // Domain, then prefix. Prefix lookup tolerates a missing trailing slash.
  const normalisedPrefix = input.endsWith("/") ? input : `${input}/`;

  const { data, error } = await supabase
    .from("sites")
    .select(columns)
    .or(`domain.eq.${input.toLowerCase()},s3_prefix.eq.${normalisedPrefix}`);

  if (error) throw new Error(error.message);

  const rows = (data ?? []) as SiteRow[];

  if (rows.length === 0) throw new Error(`No site matching "${input}"`);
  if (rows.length > 1) {
    throw new Error(
      `"${input}" matches ${rows.length} sites:\n` +
      rows.map((r) => `  ${r.id}  ${r.domain ?? "(no domain)"}  ${r.s3_prefix ?? ""}`).join("\n") +
      `\nRe-run with the UUID.`,
    );
  }

  return rows[0]!;
}

// ============================================================================
// OUTPUT
// ============================================================================

function printSite(site: SiteRow): void {
  console.log(`
  ${site.name}
    id            ${site.id}
    domain        ${site.domain ?? "—"}
    prefix        ${site.s3_prefix ?? "—"}
    status        ${site.provisioning_status}
    distribution  ${site.distribution_id ?? "—"}
    cert          ${site.cert_arn ?? "—"}
    published     ${site.published_version_id ? "yes" : "no"}
`);
}

/**
 * The part people skip.
 *
 * Printed with the ARNs already substituted, because a cleanup step that
 * requires looking up an ARN afterwards is a cleanup step that does not happen
 * — and the resulting CNAMEAlreadyExists on the next run does not obviously
 * point back at the reset.
 */
function printAwsCleanup(site: SiteRow): void {
  if (!site.cert_arn && !site.distribution_id) return;

  console.log(`
  ───────────────────────────────────────────────────────────────────
  AWS RESOURCES STILL EXIST — clean these up before re-running
  ───────────────────────────────────────────────────────────────────`);

  if (site.distribution_id && site.domain) {
    console.log(`
  1. Remove the alias "${site.domain}" from distribution ${site.distribution_id}

     CloudFront rejects a duplicate CNAME across the whole account, so
     leaving this blocks re-adding it even to the same distribution.

     aws cloudfront get-distribution-config --id ${site.distribution_id} > /tmp/dist.json
     # edit /tmp/dist.json: remove "${site.domain}" from
     #   DistributionConfig.Aliases.Items and decrement .Quantity
     # also clear ViewerCertificate if it points at the cert below
     jq '.DistributionConfig' /tmp/dist.json > /tmp/config.json
     aws cloudfront update-distribution --id ${site.distribution_id} \\
       --distribution-config file:///tmp/config.json \\
       --if-match $(jq -r '.ETag' /tmp/dist.json)`);
  }

  if (site.cert_arn) {
    console.log(`
  ${site.distribution_id ? "2" : "1"}. Delete the certificate

     Re-running requests a NEW cert; this one lingers unattached. ACM caps
     issuance around 2500/year per account — reachable in a heavy test week.
     It cannot be deleted while attached, so do the alias step first.

     aws acm delete-certificate --region us-east-1 \\
       --certificate-arn ${site.cert_arn}`);
  }

  console.log(`
  Not needed:
    Namecheap host records — setHosts REPLACES the full set on the next run
    S3 prefix              — the build overwrites index.html; media is hashed
  ───────────────────────────────────────────────────────────────────`);
}

async function confirm(question: string): Promise<boolean> {
  if (SKIP_CONFIRM) return true;

  const rl = createInterface({ input: stdin, output: stdout });
  const answer = await rl.question(`${question} [y/N] `);
  rl.close();

  return answer.trim().toLowerCase() === "y";
}

// ============================================================================
// MAIN
// ============================================================================

async function main() {
  const supabase = await adminSession();
  const site = await resolveSite(supabase, target);

  printSite(site);

  // ---- Describe the action before asking ----
  const actions: string[] = [];

  if (UNBLOCK) {
    actions.push("clear the blocked run (history preserved)");
  } else if (BUILDS_ONLY) {
    actions.push("delete all builds", "clear the published pointer");
  } else if (FROM_STEP) {
    actions.push(`delete provisioning events from "${FROM_STEP}" onward`,
                 "cancel any in-flight run");
  } else {
    actions.push("delete ALL provisioning events and runs",
                 "clear cert/distribution/hosted-zone from the site");
    if (DROP_DOMAIN) actions.push("clear the domain");
    if (FULL) actions.push("delete all builds AND site versions");
  }

  console.log("  This will:");
  for (const a of actions) console.log(`    · ${a}`);
  console.log();

  if (!(await confirm("  Proceed?"))) {
    console.log("  Cancelled.\n");
    return;
  }

  // ---- Execute ----
  let result: unknown;
  let error: { message: string } | null = null;

  if (UNBLOCK) {
    ({ data: result, error } = await supabase.rpc("unblock_provisioning", {
      p_site_id: site.id,
    }));
  } else if (BUILDS_ONLY) {
    ({ data: result, error } = await supabase.rpc("reset_builds", {
      p_site_id: site.id,
      p_keep_versions: true,
    }));
  } else if (FROM_STEP) {
    ({ data: result, error } = await supabase.rpc("rewind_provisioning", {
      p_site_id: site.id,
      p_from_step: FROM_STEP,
    }));
  } else if (FULL) {
    ({ data: result, error } = await supabase.rpc("reset_site_full", {
      p_site_id: site.id,
    }));
  } else {
    ({ data: result, error } = await supabase.rpc("reset_provisioning", {
      p_site_id: site.id,
      p_keep_domain: !DROP_DOMAIN,
    }));
  }

  if (error) {
    if (error.message.includes("disabled in production")) {
      console.error(`
  ✗ These helpers are disabled in production.

    If this IS a development database, unset the flag:
      alter database postgres reset app.environment;
`);
      process.exit(1);
    }

    if (error.message.includes("requires super admin")) {
      console.error(`
  ✗ ${requireEnv("ADMIN_EMAIL")} is not an active super admin.

    Check: select * from private.super_admins;
`);
      process.exit(1);
    }

    console.error(`  ✗ ${error.message}\n`);
    process.exit(1);
  }

  console.log("  Done:", JSON.stringify(result, null, 2).replace(/\n/g, "\n  "), "\n");

  // ---- The part that matters ----
  // Uses the PRE-reset site row: the RPC has already nulled these columns.
  if (!UNBLOCK && !BUILDS_ONLY) {
    printAwsCleanup(site);
  }

  console.log(`
  Then re-run:
    · Purchase — POST /api/sites/${site.id}/provisioning { "kind": "purchase", ... }
    · Setup    — POST /api/sites/${site.id}/provisioning { "kind": "setup", ... }
`);
}

main().catch((err) => {
  console.error(`\n  ✗ ${err instanceof Error ? err.message : err}\n`);
  process.exit(1);
});