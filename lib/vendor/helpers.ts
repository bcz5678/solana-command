
// ============================================================================
// lib/vendor/helpers.ts
//
// Shared across the ingest routes: dispatchToN8n (§1, §2), failJob (§1, §2),
// cleanupStaging (§3, called from
// app/api/internal/vendor/ingest/[jobId]/result/route.ts). No local auth
// helper lives here — that route uses requireInternalAuth() from
// lib/internal/guard.ts directly, same as every other /api/internal/* route.
// ============================================================================

import { createAdminClient } from "../supabase/admin";
import { deleteStaged, VENDOR_BUCKET } from "./s3";
import { signPayload } from "../internal/guard";

/**
 * Fire the n8n webhook.
 *
 * Everything the workflow needs comes from the job row and the catalogue, so
 * the two sides cannot disagree about what is being ingested. callbackUrl
 * travels in the payload rather than living in n8n config, so one workflow
 * serves every environment and a staging run cannot call back into
 * production — but it is routing, not a credential.
 *
 * No credential secret travels in the body. n8n holds INTERNAL_API_SECRET as
 * a stored credential for the callback leg; the outbound leg is authenticated
 * the same way app/api/internal/provisioning/dispatch/route.ts authenticates
 * into n8n — two independent checks, same pattern:
 *   X-N8N-WEBHOOK-SECRET  the webhook trigger node's own Header Auth
 *                         credential, raw, not HMAC'd, not in the body.
 *   X-Signature           HMAC-SHA256 of the exact body bytes, keyed on
 *                         N8N_WEBHOOK_SECRET, so n8n can confirm the payload
 *                         wasn't altered in transit.
 *
 * jobToken (private.vendor_ingest_jobs.job_token) DOES travel in the body —
 * it isn't a shared secret, it's a per-job capability n8n must echo back on
 * the callback so completing job A can't be done by anyone who only knows
 * job B's id plus the shared INTERNAL_API_SECRET. Same pattern as
 * provisioning's runToken.
 */
export async function dispatchToN8n(
  jobId: string,
  archiveKey: string | null,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const url = process.env.N8N_VENDOR_INGEST_URL;
  const webhookSecret = process.env.N8N_WEBHOOK_SECRET;
  const appUrl = process.env.APP_URL;

  if (!url || !webhookSecret || !appUrl) {
    return { ok: false, error: "vendor ingest env not configured" };
  }

  const supabase = createAdminClient();
  const { data: job } = await supabase.rpc("get_vendor_ingest_job", { p_job_id: jobId });

  if (!job) return { ok: false, error: "job disappeared before dispatch" };

  // Read at dispatch time, not copied onto the job at creation: the
  // catalogue is the source of truth for where a package comes from, so a
  // corrected upstream URL applies to a job already queued instead of only
  // to jobs created after the fix.
  let sourceUrlTemplate: string | null = null;

  if (job.source === "registry") {
    const { data: catalog } = await supabase.rpc("get_vendor_catalog_entry", {
      p_package_id: job.package_id,
    });

    // source_url_template is deliberately nullable — Manrope has none,
    // because Google Fonts publishes no downloadable archive. Without this
    // guard a registry job on an upload-only package dispatches fine and
    // fails minutes later inside the workflow, where the error points at a
    // missing URL rather than at the catalogue row that actually explains it.
    if (!catalog?.source_url_template) {
      return { ok: false, error: `no source_url_template for ${job.package_id}; upload-only` };
    }

    sourceUrlTemplate = catalog.source_url_template as string;
  }

  // Serialize once. Signing a second, separately-produced JSON.stringify call
  // would be equal to the body today and silently stop being equal the day
  // someone adds a field or a replacer to one call and not the other.
  const serialised = JSON.stringify({
    jobId,
    jobToken: job.job_token,
    source: job.source,
    packageId: job.package_id,
    version: job.version,
    kind: job.kind,
    sourceUrlTemplate,
    bucket: VENDOR_BUCKET,
    archiveKey,
    destPrefix: `_vendor/${job.package_id}@${job.version}/`,
    callbackUrl: `${appUrl}/api/internal/vendor/ingest/${jobId}/result`,
  });

  console.debug("[vendor-ingest] dispatching to n8n", {
    jobId,
    url,
    source: job.source,
    packageId: job.package_id,
    version: job.version,
    // Presence only — never the value.
    webhookSecretSet: Boolean(webhookSecret),
  });

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        // The webhook trigger node's own Header Auth credential — same
        // pattern app/api/internal/provisioning/dispatch/route.ts uses.
        "X-N8N-WEBHOOK-SECRET": webhookSecret,
        "X-Signature": signPayload(serialised),
      },
      body: serialised,
      // n8n acknowledges quickly and works asynchronously; a longer wait only
      // delays reporting a workflow that never started.
      signal: AbortSignal.timeout(10_000),
    });

    if (!response.ok) {
      const bodyText = await response.text().catch(() => "<unreadable body>");
      console.error("[vendor-ingest] n8n rejected dispatch", {
        jobId,
        url,
        status: response.status,
        statusText: response.statusText,
        body: bodyText,
        // Headers that commonly explain a 403 from n8n's Header Auth /
        // reverse proxy in front of it, without dumping the full header set.
        headers: {
          "www-authenticate": response.headers.get("www-authenticate"),
          server: response.headers.get("server"),
          "content-type": response.headers.get("content-type"),
        },
      });

      return { ok: false, error: `n8n responded ${response.status}` };
    }

    return { ok: true };
  } catch (caught) {
    console.error("[vendor-ingest] n8n dispatch threw", { jobId, url, error: caught });
    return { ok: false, error: (caught as Error).message };
  }
}
 
export async function failJob(jobId: string, jobToken: string, message: string): Promise<void> {
  const supabase = createAdminClient();
  await supabase.rpc("svc_apply_vendor_ingest_result", {
    p_job_id: jobId,
    p_job_token: jobToken,
    p_status: "failed",
    p_error: message,
  });
}
 
/** Remove the staging archive once the job is terminal, either way. */
export async function cleanupStaging(
  supabase: ReturnType<typeof createAdminClient>,
  jobId: string,
): Promise<void> {
  const { data: job } = await supabase.rpc("get_vendor_ingest_job", { p_job_id: jobId });
  if (job?.staging_key) await deleteStaged(job.staging_key);
}