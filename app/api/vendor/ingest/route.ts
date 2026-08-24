
// ============================================================================
// §1 — app/api/vendor/ingest/route.ts
// ============================================================================
 
import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { 
    dispatchToN8n,
    failJob
} from "@/lib/vendor/helpers";
import { 
    stagingKey, 
    presignArchiveUpload ,
    UPLOAD_TTL_SECONDS, 
    MAX_ARCHIVE_BYTES, 
} from "@/lib/vendor/s3";

 
export const dynamic = "force-dynamic";
 
/** Matches private.dependency_kind exactly. */
const KindSchema = z.enum(["stylesheet", "script", "font", "iconset", "polyfill"]);
 
/** Matches private.dependency_strategy exactly. */
const StrategySchema = z.enum(["inline", "copy", "shared", "external"]);
 
const IngestRequestSchema = z.object({
  source: z.enum(["registry", "upload"]),
  packageId: z.string().min(1).regex(/^[a-z0-9][a-z0-9-]*$/, "lowercase and hyphens only"),
  version: z.string().min(1).max(64),
  kind: KindSchema,
 
  // ---- Curation ----
  // None of this is derivable from an archive. It is written to the package row
  // by upsert_vendor_version_unchecked, so it travels on the job rather than
  // being trusted from the callback.
  displayName: z.string().min(1),
 
  /**
   * `inline` only works for an iconset whose glyphs were extracted, so a
   * package declaring it without glyphs would throw at build. Left to the form
   * for now; worth constraining once the workflow reports what it found.
   */
  allowedStrategies: z.array(StrategySchema).min(1).default(["copy"]),
 
  licenseSpdx: z.string().optional(),
  /** A licence obligation that ends up in generated site footers. */
  requiresAttribution: z.boolean().default(false),
  attributionText: z.string().optional(),
  noticeUrl: z.string().url().optional(),
 
  // ---- Upload only ----
  filename: z.string().min(1).optional(),
  contentType: z.string().min(1).optional(),
  contentLength: z.number().int().positive().max(MAX_ARCHIVE_BYTES).optional(),
}).superRefine((body, ctx) => {
  // `external` packages store absolute URLs in files[].path and upload nothing,
  // so they are a manual registry row rather than an ingest job.
  if (body.allowedStrategies.length === 1 && body.allowedStrategies[0] === "external") {
    ctx.addIssue({
      code: "custom",
      path: ["allowedStrategies"],
      message: "External-only packages are registered directly, not ingested.",
    });
  }
 
  if (body.requiresAttribution && !body.attributionText) {
    ctx.addIssue({
      code: "custom",
      path: ["attributionText"],
      message: "Required when requiresAttribution is set — it is rendered in site footers.",
    });
  }
 
  if (body.source !== "upload") return;
 
  for (const field of ["filename", "contentType", "contentLength"] as const) {
    if (body[field] === undefined) {
      ctx.addIssue({ code: "custom", path: [field], message: "Required for uploads." });
    }
  }
 
  // A catalogue package's licence is known; an uploaded archive's rests
  // entirely on whoever uploaded it — and it may end up on every customer
  // domain.
  if (!body.licenseSpdx) {
    ctx.addIssue({ code: "custom", path: ["licenseSpdx"], message: "Required for uploads." });
  }
});
 
export async function POST(request: Request): Promise<NextResponse> {
  const supabase = await createClient();
 
  const parsed = IngestRequestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues }, { status: 400 });
  }
 
  const body = parsed.data;
 
  // The wrapper gates on is_super_admin_db() and rejects an already-ingested
  // version, so nothing is uploaded for a job that could never succeed.
  // Returns { id, token } — the token is the callback's per-job capability
  // (private.vendor_ingest_jobs.job_token), never exposed past this route.
  const { data: job, error } = await supabase.rpc("admin_create_vendor_ingest_job", {
    p_package_id: body.packageId,
    p_version: body.version,
    p_kind: body.kind,
    p_source: body.source,
    p_display_name: body.displayName,
    p_allowed_strategies: body.allowedStrategies,
    p_license_spdx: body.licenseSpdx ?? null,
    p_requires_attribution: body.requiresAttribution,
    p_attribution_text: body.attributionText ?? null,
    p_notice_url: body.noticeUrl ?? null,
  });
 
  if (error) {
    // Already ingested is a legitimate state, not a fault — the UI should say
    // so rather than reporting a generic failure.
    const status = /already ingested/.test(error.message) ? 409 : 400;
    return NextResponse.json({ error: error.message }, { status });
  }

  const jobId = (job as { id: string; token: string }).id;
  const jobToken = (job as { id: string; token: string }).token;
 
  if (body.source === "registry") {
    const dispatched = await dispatchToN8n(jobId, null);
 
    if (!dispatched.ok) {
      await failJob(jobId, jobToken, `dispatch failed: ${dispatched.error}`);
      return NextResponse.json({ error: dispatched.error }, { status: 502 });
    }
 
    return NextResponse.json({ jobId, dispatched: true }, { status: 202 });
  }
 
  const key = stagingKey(jobId, body.filename!);
  const uploadUrl = await presignArchiveUpload(key, body.contentType!, body.contentLength!);
 
  const { error: keyError } = await supabase.rpc("admin_set_vendor_job_staging_key", {
    p_job_id: jobId,
    p_staging_key: key,
  });
 
  if (keyError) {
    return NextResponse.json({ error: keyError.message }, { status: 500 });
  }
 
  return NextResponse.json(
    { jobId, uploadUrl, stagingKey: key, expiresIn: UPLOAD_TTL_SECONDS },
    { status: 202 },
  );
}