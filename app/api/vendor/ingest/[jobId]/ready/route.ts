
// ============================================================================
// §2 — app/api/vendor/ingest/[jobId]/ready/route.ts
//
// Called after the browser's PUT completes. Verifies the object is there before
// telling n8n to read it — a workflow dispatched against a missing archive
// fails minutes later with an error pointing at S3 rather than at the upload
// that never finished.
// ============================================================================

import { NextResponse} from "next/server";
// This route runs on the server (a Next.js Route Handler) — the browser
// client (createBrowserClient, no cookie plumbing) previously imported here
// carried no session, so get_vendor_ingest_job ran unauthenticated instead
// of as the calling admin. @/lib/supabase/server reads the request's auth
// cookies the way every other route in this chain does.
import { createClient } from "@/lib/supabase/server";

import { dispatchToN8n, failJob } from "@/lib/vendor/helpers";
import { MAX_ARCHIVE_BYTES, headArchive, deleteStaged } from "@/lib/vendor/s3";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ jobId: string }> },
): Promise<NextResponse> {
  const { jobId } = await params;
  const supabase = await createClient();
 
  const { data: job, error } = await supabase.rpc("get_vendor_ingest_job", {
    p_job_id: jobId,
  });
 
  if (error || !job) {
    return NextResponse.json({ error: "no such job" }, { status: 404 });
  }
 
  // Double-submit from the client, or a retry after a timeout. Not an error.
  if (job.status !== "queued") {
    return NextResponse.json({ status: job.status }, { status: 200 });
  }
 
  if (!job.staging_key) {
    return NextResponse.json({ error: "job has no staging key" }, { status: 400 });
  }
 
  const archive = await headArchive(job.staging_key);
 
  if (!archive.exists) {
    await failJob(jobId, job.job_token, "archive was never uploaded to staging");
    return NextResponse.json({ error: "archive not found in staging" }, { status: 409 });
  }
 
  // ContentLength is signed into the presigned PUT, so this is belt and braces
  // — but this is the first point where the real object size is known.
  if (archive.bytes > MAX_ARCHIVE_BYTES) {
    await deleteStaged(job.staging_key);
    await failJob(jobId, job.job_token, `archive is ${archive.bytes} bytes, over the limit`);
    return NextResponse.json({ error: "archive too large" }, { status: 413 });
  }
 
  const dispatched = await dispatchToN8n(jobId, job.staging_key);
 
  if (!dispatched.ok) {
    await failJob(jobId, job.job_token, `dispatch failed: ${dispatched.error}`);
    return NextResponse.json({ error: dispatched.error }, { status: 502 });
  }
 
  return NextResponse.json({ jobId, dispatched: true }, { status: 202 });
}