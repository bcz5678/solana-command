
// ============================================================================
// app/api/internal/vendor/ingest/[jobId]/result/route.ts
//
// POST /api/internal/vendor/ingest/:jobId/result
//
// n8n's only write path into vendor ingest state. Moved here (from
// /api/vendor/callback) so it sits under the same guard every other n8n
// callback uses — requireInternalAuth() — instead of a local reimplementation
// of the same secretMatches() comparison. Same reasoning as
// app/api/internal/provisioning/[runId]/step/route.ts.
//
// Three properties n8n relies on:
//   idempotent   it retries on any non-2xx
//   order-free   a late 'running' after 'succeeded' must not reopen the job
//   loud on auth a bad secret is 401, never a silent no-op
//
// The route holds the service key, so auth.uid() is null and the super-admin
// gate cannot apply. Authorization is two layers, same as provisioning:
// requireInternalAuth() (the shared INTERNAL_API_SECRET, generic to every
// /api/internal/* route) plus jobToken (private.vendor_ingest_jobs.job_token,
// specific to this job) checked inside svc_apply_vendor_ingest_result — the
// callback supplies only files/glyphs/faces, while package id, version and
// every curation field are read from a job a super admin created.
// ============================================================================

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { cleanupStaging } from "@/lib/vendor/helpers";
import { requireInternalAuth } from "@/lib/internal/guard";

type Params = { params: Promise<{ jobId: string }> };

const CallbackSchema = z.object({
  jobToken: z.string().uuid(),
  status: z.enum(["running", "succeeded", "failed"]),

  /**
   * As actually extracted, never echoed from the request.
   *
   * `integrity` is an SRI hash — sha384 base64, not hex. hashedName() derives
   * the shipped filename from it, and upsert_vendor_version_unchecked rejects
   * anything not matching ^sha(256|384|512)-.
   *
   * Exactly one file must carry `entry: true`. resolveCopy uses it for the
   * <link> href; with none marked it falls back to files[0], which on an
   * iconset is usually a webfont, and the stylesheet then never loads.
   */
  files: z.array(z.object({
    path: z.string().min(1),
    integrity: z.string().regex(/^sha(256|384|512)-/, "must be an SRI hash"),
    contentType: z.string().min(1),
    entry: z.boolean().optional(),
  })).min(1).optional(),

  /**
   * Iconsets only: name -> { viewBox, path }. resolveInline builds an SVG
   * symbol sprite from this, so it must be real extracted geometry — Font
   * Awesome's CSS gives codepoints, not paths, which means reading the
   * package's svgs/ directory rather than parsing the stylesheet.
   */
  glyphs: z.record(z.string(), z.object({
    viewBox: z.string().min(1),
    path: z.string().min(1),
  })).optional(),

  /**
   * Fonts only. selectFiles filters on this, so a package without it ships
   * every weight regardless of what the template declared.
   */
  faces: z.array(z.object({
    family: z.string().min(1),
    weight: z.number().int(),
    style: z.enum(["normal", "italic"]),
    subset: z.string().min(1),
    path: z.string().min(1),
  })).optional(),

  error: z.string().optional(),
}).superRefine((body, ctx) => {
  if (body.status !== "succeeded") return;

  if (!body.files) {
    ctx.addIssue({ code: "custom", path: ["files"], message: "Required on success." });
    return;
  }

  const entries = body.files.filter((f) => f.entry).length;
  if (entries !== 1) {
    // The database enforces this too; catching it here gives a clearer message
    // than a raised exception surfacing as a 500.
    ctx.addIssue({
      code: "custom",
      path: ["files"],
      message: `Exactly one file must have entry:true (found ${entries}).`,
    });
  }
});

export async function POST(request: NextRequest, { params }: Params): Promise<NextResponse> {
  const denied = requireInternalAuth(request);
  if (denied) return denied;

  const { jobId } = await params;

  const parsed = CallbackSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    // 400, not 500: it will be malformed on retry too, and n8n should stop
    // rather than loop.
    return NextResponse.json({ error: parsed.error.issues }, { status: 400 });
  }

  const body = parsed.data;
  const supabase = createAdminClient();

  const { data: status, error } = await supabase.rpc("svc_apply_vendor_ingest_result", {
    p_job_id: jobId,
    p_job_token: body.jobToken,
    p_status: body.status,
    p_files: body.files ?? null,
    p_glyphs: body.glyphs ?? null,
    p_faces: body.faces ?? null,
    p_error: body.error ?? null,
  });

  if (error) {
    // A connection failure is transient — the stack was down, the network
    // blipped — and n8n should retry. A rejection from the function itself is
    // permanent and will be rejected identically next time, so the job is failed
    // and 200 stops the retry loop. Answering 200 to both means a temporary
    // outage silently kills the job.
    if (isTransient(error)) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }


    // Stale/wrong jobToken, or no such job — svc_apply_vendor_ingest_result
    // raises one message for both, same as provisioning's
    // record_provisioning_event. 409/not-retryable, same as
    // app/api/internal/provisioning/[runId]/step/route.ts uses for the
    // equivalent case: none of these improve on a second attempt, and this
    // must not fall into the generic failure path below — failing the job on
    // behalf of a caller who never proved they own it would let a token-less
    // request terminate a job it has no claim to.
    if (/job token is stale/.test(error.message)) {
      return NextResponse.json({ error: error.message, retryable: false }, { status: 409 });
    }

    // A raised exception from the upsert — bad SRI, wrong entry count, or a
    // version that already exists with different contents. Fail the job so it
    // stops being queued, then answer 200 so n8n does not retry a payload that
    // will be rejected identically.
    await supabase.rpc("svc_apply_vendor_ingest_result", {
      p_job_id: jobId,
      p_job_token: body.jobToken,
      p_status: "failed",
      p_error: error.message,
    });

    await cleanupStaging(supabase, jobId);
    return NextResponse.json({ status: "failed", error: error.message }, { status: 200 });
  }

  if (status === "succeeded" || status === "failed") {
    await cleanupStaging(supabase, jobId);
  }

  // 200 even for a duplicate delivery against an already-terminal job.
  return NextResponse.json({ status }, { status: 200 });
}


/**
 * Infrastructure failure vs. a rejection from our own SQL.
 *
 * `raise exception` in plpgsql produces SQLSTATE P0001 — that is every
 * deliberate refusal in svc_apply_vendor_ingest_result: bad SRI, wrong entry
 * count, stale token, version conflict. Those are permanent and will be
 * rejected identically on retry, so the job is failed and 200 stops the loop.
 *
 * Anything else — an unreachable PostgREST, a dropped connection, a timeout —
 * is transient. Answering 200 to those means a thirty-second outage silently
 * kills a job whose workflow completed successfully.
 */
function isTransient(error: { code?: string; message?: string }): boolean {
  if (error.code === "P0001") return false;   // our own raise
  if (error.code) return false;               // any other SQLSTATE: reached PG

  // No SQLSTATE means the request never got a database response.
  return true;
}