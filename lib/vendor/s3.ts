// ============================================================================
// lib/vendor/s3.ts
//
// §0 of the vendor ingest chain — shared S3 primitives, no business logic.
// The three routes are split out:
//
//   app/api/vendor/ingest/route.ts                              §1  create job + presign
//   app/api/vendor/ingest/[jobId]/ready/route.ts                §2  dispatch after upload
//   app/api/internal/vendor/ingest/[jobId]/result/route.ts      §3  n8n reports back
//
// Business logic (dispatchToN8n, failJob, cleanupStaging) lives in
// lib/vendor/helpers.ts, which imports FROM here — not the other way. This
// file only knows about S3; it must not import helpers.ts, or the two end up
// depending on each other.
//
// ---------------------------------------------------------------------------
// SEQUENCE — job first, bytes second.
//
//   1. POST /api/vendor/ingest            -> { jobId, uploadUrl }   (upload only)
//   2. browser PUTs the archive straight to S3
//   3. POST /api/vendor/ingest/{id}/ready -> dispatches to n8n
//   4. n8n reads _staging/{jobId}/, writes _vendor/{pkg}@{ver}/, calls back
//
// The job row exists before any bytes move, so a rejected job — a version
// already ingested, or not a super admin — fails before an archive is uploaded
// rather than leaving one orphaned in the bucket.
//
// Registry fetches skip 1–3: there is nothing to upload, so the first request
// dispatches directly.
// ============================================================================

import {
  S3Client, PutObjectCommand, HeadObjectCommand, DeleteObjectCommand,
  S3ServiceException,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

// Owned here, not in helpers.ts: helpers.ts imports deleteStaged from this
// file, so if these constants lived there instead, the two files would
// import each other. S3 configuration belongs with the S3 primitives that
// use it either way.
export const UPLOAD_TTL_SECONDS = 900;
export const MAX_ARCHIVE_BYTES = 100 * 1024 * 1024;
// SITES_BUCKET, not a vendor-specific var — coin-sites is what the site-build
// path already reads this same variable to reach (scripts/seed-vendor.ts,
// scripts/import-bundle.ts, app/api/internal/media/derive/route.ts).
// drs-token-media (AWS_S3_TOKEN_BUCKET_NAME) is token media metadata, unrelated
// to the site builder or the vendor registry.
export const VENDOR_BUCKET = process.env.SITES_BUCKET!;
export const STAGING_FOLDER = process.env.AWS_S3_STAGING_FOLDER ?? "_staging";

export function vendorS3(): S3Client {
  return new S3Client({
    region: process.env.AWS_S3_REGION,
    credentials: {
      accessKeyId: process.env.AWS_S3_ACCESS_KEY!,
      secretAccessKey: process.env.AWS_S3_SECRET_ACCESS_KEY!,
    },
  });
}
 
/**
 * Staging key for a job's archive.
 *
 * Namespaced by jobId, and the filename is sanitized rather than trusted.
 * Taking a client-supplied name verbatim lets a caller write `../` paths or
 * overwrite an existing object by choosing its name — the jobId prefix would
 * contain that anyway, but the sanitize is what makes it true by construction.
 */
export function stagingKey(jobId: string, filename: string): string {
  const safe = filename
    .replace(/[^a-zA-Z0-9._-]/g, "-")
    .replace(/^\.+/, "")
    .slice(0, 120) || "archive";
 
  return `${STAGING_FOLDER}/${jobId}/${safe}`;
}
 
/**
 * Presigned PUT for exactly one object.
 *
 * ContentType and ContentLength are signed in, so a leaked URL cannot be reused
 * to upload something else or something enormous. A bare presigned PUT accepts
 * any body of any size.
 */
export async function presignArchiveUpload(
  key: string,
  contentType: string,
  contentLength: number,
): Promise<string> {
  return getSignedUrl(
    vendorS3(),
    new PutObjectCommand({
      Bucket: VENDOR_BUCKET,
      Key: key,
      ContentType: contentType,
      ContentLength: contentLength,
    }),
    { expiresIn: UPLOAD_TTL_SECONDS },
  );
}
 
export async function headArchive(key: string): Promise<{ exists: boolean; bytes: number }> {
  try {
    const head = await vendorS3().send(
      new HeadObjectCommand({ Bucket: VENDOR_BUCKET, Key: key }),
    );
    return { exists: true, bytes: head.ContentLength ?? 0 };
  } catch (caught) {
    if (caught instanceof S3ServiceException && caught.name === "NotFound") {
      return { exists: false, bytes: 0 };
    }
    throw caught;
  }
}
 
/** Best-effort. The bucket lifecycle rule is what actually guarantees cleanup. */
export async function deleteStaged(key: string): Promise<void> {
  try {
    await vendorS3().send(new DeleteObjectCommand({ Bucket: VENDOR_BUCKET, Key: key }));
  } catch {
    // A leftover staging object is a 24-hour lifecycle problem, not a reason to
    // fail an otherwise-good ingest.
  }
}