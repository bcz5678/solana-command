// ============================================================================
// app/api/internal/media/derive/route.ts
//
// POST /api/internal/media/derive
//
// Derives ONE published image: fetch the staged original from Supabase Storage,
// crop to the template's target aspect around the author's focal point, scale,
// encode, and PUT to S3.
//
// One image per call, deliberately. n8n owns the loop and the concurrency, so:
//   • each request is short and nowhere near maxDuration, regardless of how
//     many images a site has
//   • a single failed image retries on its own rather than restarting the batch
//   • n8n never holds a Supabase credential — it passes opaque keys back and
//     forth and never learns what the storage layer is
//
// Bytes never transit n8n. Supabase -> Next.js -> S3, server side throughout.
// ============================================================================

import { NextRequest, NextResponse } from "next/server";
import sharp from "sharp";
import { S3Client, PutObjectCommand, HeadObjectCommand } from "@aws-sdk/client-s3";
import { requireInternalAuth, adminClient } from "@/lib/internal/guard";
import { computeCrop, computeOutputSize } from "@/lib/internal/crop";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// A single 2400px webp encode. Generous headroom for a cold sharp init.
export const maxDuration = 60;

const BUCKET = "site-media";

let s3: S3Client | null = null;
function s3Client(): S3Client {
  s3 ??= new S3Client({ region: process.env.AWS_REGION! });
  return s3;
}

interface DeriveBody {
  buildId: string;
  claimToken: string;
  entry: {
    sourceKey: string;      // Supabase Storage object key
    destKey: string;        // S3 key, content-hashed
    contentType: string;
    cacheControl: string;
    transform: {
      aspect: string;
      width: number;
      focalX: number;
      focalY: number;
    };
  };
}

export async function POST(req: NextRequest) {
  const denied = requireInternalAuth(req);
  if (denied) return denied;

  let body: DeriveBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { buildId, claimToken, entry } = body;

  if (!buildId || !claimToken || !entry?.sourceKey || !entry?.destKey) {
    return NextResponse.json(
      { error: "buildId, claimToken and entry are required" },
      { status: 400 },
    );
  }

  const supabase = adminClient();

  // ---- 1. Authorize against the build ----
  //
  // The shared secret alone is not enough. Without this check the endpoint is
  // an arbitrary S3 writer for anyone who obtains it: post any destKey and any
  // source, and it writes into any site's prefix.
  //
  // Binding to a live claim means a caller must also hold a token issued to an
  // in-flight build, and the destKey must sit under that build's own prefix.
  // private is not PostgREST-reachable even for service_role — that's a
  // schema-exposure restriction, not an RLS one — so this goes through the
  // internal (no ownership gate; the caller is already trusted) wrapper.
  const { data: buildRows, error: buildErr } = await supabase
    .rpc("orchestrator_get_build", { p_build_id: buildId });
  const build = (buildRows as unknown as Array<{
    id: string; site_id: string; status: string; claim_token: string; s3_prefix: string | null;
  }> | null)?.[0];

  if (buildErr || !build) {
    return NextResponse.json({ error: "Build not found" }, { status: 404 });
  }

  if (build.claim_token !== claimToken) {
    return NextResponse.json(
      { error: "Stale claim token", retryable: false },
      { status: 409 },
    );
  }

  if (["live", "failed", "cancelled"].includes(build.status)) {
    return NextResponse.json(
      { error: `Build is already ${build.status}`, retryable: false },
      { status: 409 },
    );
  }

  // Path confinement. Even with a valid token, a build may only write beneath
  // its own site's prefix.
  if (!build.s3_prefix || !entry.destKey.startsWith(build.s3_prefix)) {
    return NextResponse.json(
      { error: "destKey is outside this build's prefix", retryable: false },
      { status: 403 },
    );
  }

  const bucket = process.env.SITES_BUCKET!;

  try {
    // ---- 2. Skip if already present ----
    //
    // destKey is hashed over identity, aspect, width and focal point, so an
    // existing object with this key is byte-identical to what we would produce.
    // On a rebuild where images did not change, this skips every derivation.
    try {
      await s3Client().send(new HeadObjectCommand({ Bucket: bucket, Key: entry.destKey }));
      return NextResponse.json(
        { destKey: entry.destKey, skipped: true, reason: "already exists" },
        { status: 200 },
      );
    } catch {
      // Not found — proceed. HeadObject throws rather than returning null.
    }

    // ---- 3. Fetch the staged original ----
    const { data: blob, error: downloadErr } = await supabase.storage
      .from(BUCKET)
      .download(entry.sourceKey);

    if (downloadErr || !blob) {
      return NextResponse.json(
        {
          error: `Could not read staged image: ${downloadErr?.message ?? "not found"}`,
          sourceKey: entry.sourceKey,
          // Almost always a deleted asset still referenced by the draft, which
          // no retry will fix.
          retryable: false,
        },
        { status: 404 },
      );
    }

    const input = Buffer.from(await blob.arrayBuffer());

    // ---- 4. Crop ----
    const meta = await sharp(input).metadata();

    if (!meta.width || !meta.height) {
      return NextResponse.json(
        { error: "Could not determine source dimensions", retryable: false },
        { status: 422 },
      );
    }

    const crop = computeCrop({
      sourceWidth: meta.width,
      sourceHeight: meta.height,
      aspect: entry.transform.aspect,
      focalX: entry.transform.focalX,
      focalY: entry.transform.focalY,
    });

    const output = computeOutputSize(crop, entry.transform.width);

    // extract() then resize(), NOT resize({ fit: "cover" }).
    //
    // fit:"cover" crops around the CENTRE, which would silently discard the
    // focal point the author positioned and disagree with the form's preview.
    const derived = await sharp(input)
      .rotate()                       // apply EXIF orientation before extracting
      .extract(crop)
      .resize({ width: output.width, withoutEnlargement: true })
      .webp({ quality: 82, effort: 4 })
      .toBuffer();

    // ---- 5. Publish ----
    await s3Client().send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: entry.destKey,
        Body: derived,
        ContentType: entry.contentType,
        CacheControl: entry.cacheControl,
      }),
    );

    return NextResponse.json(
      {
        destKey: entry.destKey,
        skipped: false,
        bytes: derived.length,
        dimensions: output,
        crop,
      },
      { status: 200 },
    );
  } catch (err) {
    console.error(`[media/derive] ${entry.destKey} failed:`, err);
    return NextResponse.json(
      {
        error: err instanceof Error ? err.message : "Derivation failed",
        destKey: entry.destKey,
        // Transient by assumption: S3 throttling, a memory spike, a cold start.
        // n8n retries; the reaper is the backstop if it keeps failing.
        retryable: true,
      },
      { status: 500 },
    );
  }
}