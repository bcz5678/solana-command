// ============================================================================
// app/api/sites/[siteId]/media/route.ts
//
// POST   /api/sites/:siteId/media   — upload an image, get back an ImageAsset
// DELETE /api/sites/:siteId/media   — remove an asset and all its variants
//
// MEDIA LIFECYCLE, per the pipeline design:
//
//   Upload (here) → SIZE variants only, at the source aspect ratio.
//                   Focal-INDEPENDENT, so nudging the focal point never
//                   triggers regeneration.
//   Editing       → the form previews crops in pure CSS via aspect-ratio +
//                   object-position from focalX/focalY. No server round trip.
//   Publish       → the build generates the exact crops the template's
//                   imageAspect calls for, using the final focal point.
//
// That split is why upload is fast and the focal-point picker is instant.
// ============================================================================

import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { createClient } from "@/lib/supabase/server";
import type { ImageAsset } from "@site/schema";

export const runtime = "nodejs";        // sharp is native; no edge runtime
export const dynamic = "force-dynamic";
export const maxDuration = 60;

type Params = { params: Promise<{ siteId: string }> };

const BUCKET = "site-media";
const MAX_BYTES = 25 * 1024 * 1024;     // matches the bucket's file_size_limit

/**
 * Variant widths. 2400 covers retina full-bleed hero panels; 600 covers the
 * stacked mobile fallback. Sources narrower than a given width are skipped
 * rather than upscaled.
 */
const VARIANT_WIDTHS = [2400, 1200, 600] as const;

/**
 * SVG is deliberately excluded.
 *
 * An SVG served same-origin can carry <script> and inline event handlers, which
 * would execute in the context of a customer domain — on a page whose purpose is
 * displaying a contract address. Accepting SVG requires either a sanitizer
 * (DOMPurify with an SVG profile) or rasterizing on upload. Until one of those
 * exists, reject it. NOTE: the bucket's allowed_mime_types in migration 8 still
 * lists image/svg+xml; tighten that too.
 */
const ACCEPTED = new Set([
  "image/png", "image/jpeg", "image/webp", "image/avif", "image/gif",
]);

// ============================================================================
// POST — upload
// ============================================================================

export async function POST(req: NextRequest, { params }: Params) {
  const { siteId } = await params;
  const supabase = await createClient();

  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // ---- Ownership ----
  // The storage policies enforce this too (via private.owns_site_text on path
  // segment [1]), but checking here gives a clean 404 instead of an opaque
  // storage error, and avoids doing sharp work that would be rejected anyway.
  // private is not PostgREST-reachable — owner-scoped wrapper, not .from("sites").
  const { data: siteRows } = await supabase.rpc("get_site_draft", { p_site_id: siteId });

  if (!(siteRows as unknown[] | null)?.length) {
    return NextResponse.json({ error: "Site not found" }, { status: 404 });
  }

  // ---- Parse multipart ----
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "Expected multipart/form-data" }, { status: 400 });
  }

  const file = form.get("file");
  const altText = (form.get("alt") as string | null) ?? "";

  if (!(file instanceof File)) {
    return NextResponse.json({ error: "file is required" }, { status: 400 });
  }

  if (file.size > MAX_BYTES) {
    return NextResponse.json(
      { error: `File exceeds ${Math.floor(MAX_BYTES / 1024 / 1024)}MB` },
      { status: 413 },
    );
  }

  if (!ACCEPTED.has(file.type)) {
    return NextResponse.json(
      { error: `Unsupported type "${file.type}". Accepted: ${[...ACCEPTED].join(", ")}` },
      { status: 415 },
    );
  }

  const input = Buffer.from(await file.arrayBuffer());

  // ---- Probe ----
  let meta: sharp.Metadata;
  try {
    meta = await sharp(input).metadata();
  } catch {
    // A file can claim image/png in its Content-Type and be anything at all.
    // sharp failing to parse is the real content check.
    return NextResponse.json({ error: "File is not a readable image" }, { status: 415 });
  }

  if (!meta.width || !meta.height) {
    return NextResponse.json({ error: "Could not determine image dimensions" }, { status: 415 });
  }

  // ---- Generate variants ----
  const assetId = randomUUID();
  const prefix = `${siteId}/${assetId}`;
  const variants: Record<string, string> = {};

  // Animated GIFs lose their animation through the resize pipeline, so they
  // pass through untouched. Rare enough not to warrant gifsicle.
  const isAnimated = (meta.pages ?? 1) > 1;

  try {
    if (isAnimated) {
      const key = `${prefix}/original.gif`;
      const { error } = await supabase.storage
        .from(BUCKET)
        .upload(key, input, { contentType: "image/gif", upsert: false });
      if (error) throw error;
      variants[String(meta.width)] = key;
    } else {
      for (const width of VARIANT_WIDTHS) {
        // Never upscale — a 900px source gets 600 only.
        if (meta.width < width && width !== VARIANT_WIDTHS.at(-1)) continue;

        const target = Math.min(width, meta.width);

        const buf = await sharp(input)
          .rotate()                    // apply EXIF orientation, then drop it
          .resize({ width: target, withoutEnlargement: true })
          // No .withMetadata() — sharp strips EXIF by default, which is what
          // we want. Phone photos carry GPS coordinates; a generated public
          // site should not republish the author's location.
          .webp({ quality: 82, effort: 4 })
          .toBuffer();

        const key = `${prefix}/${target}.webp`;
        const { error } = await supabase.storage
          .from(BUCKET)
          .upload(key, buf, { contentType: "image/webp", upsert: false });

        if (error) throw error;
        variants[String(target)] = key;
      }
    }

    // ---- Preserve the original ----
    // The publish step crops from this, not from a variant — cropping a
    // downscaled copy compounds quality loss.
    const ext = file.type.split("/")[1] ?? "bin";
    const originalKey = `${prefix}/original.${ext}`;

    const { error: origErr } = await supabase.storage
      .from(BUCKET)
      .upload(originalKey, input, { contentType: file.type, upsert: false });

    if (origErr) throw origErr;

    // ---- Signed URL for the editor ----
    // The bucket is private, so the form and preview need a signed URL. The KEY
    // is the durable reference stored in the definition; this URL expires and
    // is re-signed on load.
    const largest = variants[String(Math.max(...Object.keys(variants).map(Number)))];
    const { data: signed } = await supabase.storage
      .from(BUCKET)
      .createSignedUrl(largest ?? originalKey, 60 * 60 * 24 * 7);

    const asset: ImageAsset = {
      id: assetId,
      stagingKey: originalKey,
      url: signed?.signedUrl ?? "",
      alt: altText,
      decorative: false,
      width: meta.width,
      height: meta.height,
      focalX: 0.5,        // centre until the author moves it
      focalY: 0.5,
      variants,
    };

    return NextResponse.json({ asset }, { status: 201 });
  } catch (err) {
    // Best-effort cleanup so a partial upload doesn't leave orphans. The
    // scheduled orphaned_media_paths() sweep is the backstop.
    const written = [
      ...Object.values(variants),
      `${prefix}/original.${file.type.split("/")[1] ?? "bin"}`,
    ];
    await supabase.storage.from(BUCKET).remove(written).catch(() => {});

    console.error("[media] upload failed:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Upload failed" },
      { status: 500 },
    );
  }
}

// ============================================================================
// DELETE — remove an asset and every variant
// ============================================================================

export async function DELETE(req: NextRequest, { params }: Params) {
  const { siteId } = await params;
  const supabase = await createClient();

  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const assetId = new URL(req.url).searchParams.get("assetId");
  if (!assetId) {
    return NextResponse.json({ error: "assetId is required" }, { status: 400 });
  }

  const prefix = `${siteId}/${assetId}`;

  // List then remove: variant filenames depend on the source dimensions, so
  // they can't be reconstructed without reading the directory.
  const { data: files, error: listErr } = await supabase.storage
    .from(BUCKET)
    .list(prefix);

  if (listErr) {
    return NextResponse.json({ error: listErr.message }, { status: 500 });
  }

  if (!files?.length) {
    return NextResponse.json({ deleted: 0 }, { status: 200 });
  }

  // The storage DELETE policy re-checks ownership on segment [1], so a
  // mismatched siteId removes nothing rather than erroring.
  const { error: removeErr } = await supabase.storage
    .from(BUCKET)
    .remove(files.map((f) => `${prefix}/${f.name}`));

  if (removeErr) {
    return NextResponse.json({ error: removeErr.message }, { status: 500 });
  }

  // NOTE: this does not scrub references from draft_definition. A deleted asset
  // still referenced by the draft surfaces as a broken preview and, at publish,
  // as a required-content validation error. Clearing the reference is the
  // form's job — it knows which field held the asset.
  return NextResponse.json({ deleted: files.length }, { status: 200 });
}