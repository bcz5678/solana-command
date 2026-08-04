// ============================================================================
// packages/site-renderer/src/assets.ts
//
// Turns a SiteDefinition plus resolved vendor dependencies into the concrete
// list of objects that must exist in S3, and rewrites the definition so the
// rendered HTML references published paths rather than staging URLs.
//
// The renderer decides WHAT must exist; the orchestrator makes it exist. That
// boundary is what keeps this a pure function with no AWS SDK in the package.
// ============================================================================

import { createHash } from "node:crypto";
import type {
  SiteDefinition,
  ImageAsset,
  TemplateManifest,
} from "@site/schema";
import type {
  AssetCopy,
  AssetMediaEntry,
  RenderMode,
} from "./types.js";
import type { ResolvedDependency } from "./vendor.js";

// ============================================================================
// HASHING
// ============================================================================

export function sha256Hex(input: string | Buffer): string {
  return createHash("sha256").update(input).digest("hex");
}

/** CSP-style hash for an inline script: sha256-<base64>. */
export function scriptHash(source: string): string {
  return `sha256-${createHash("sha256").update(source, "utf8").digest("base64")}`;
}

/**
 * Content-hashed filename.
 *
 *   ("hero.webp", "a3f9c2...") -> "hero.a3f9c2ab.webp"
 *
 * Eight hex characters is ample: a collision needs ~2^16 assets in one site
 * prefix before it becomes likely, and the prefix is per-site.
 */
export function hashedName(path: string, hash: string): string {
  const short = hash.replace(/[^a-f0-9]/gi, "").slice(0, 8);
  const slash = path.lastIndexOf("/");
  const file = slash === -1 ? path : path.slice(slash + 1);
  const dot = file.lastIndexOf(".");

  return dot === -1
    ? `${file}.${short}`
    : `${file.slice(0, dot)}.${short}${file.slice(dot)}`;
}

// ============================================================================
// CACHE HEADERS
// ============================================================================

/**
 * Hashed assets are immutable — the filename changes when the bytes change,
 * so they never need invalidating. That is what keeps a rebuild's invalidation
 * to two paths instead of `/*`, and keeps you under CloudFront's 1,000 free
 * paths per month.
 */
export const IMMUTABLE = "public, max-age=31536000, immutable";

/** The document itself must always revalidate. */
export const DOCUMENT_CACHE = "no-cache, must-revalidate";

// ============================================================================
// MEDIA PLANNING
// ============================================================================

/** Which manifest aspect applies to a given asset slot. */
type Slot = "hero" | "section" | "card" | "gallery";

interface PlannedImage {
  asset: ImageAsset;
  slot: Slot;
}

/**
 * Walk the definition and collect every ImageAsset with the slot it occupies.
 *
 * Slot matters because the manifest declares a different target aspect per
 * slot — a 21:9 hero panel and a 1:1 gallery thumbnail crop the same source
 * very differently, which is the entire reason ImageAsset carries a focal point.
 */
export function collectImages(definition: SiteDefinition): PlannedImage[] {
  const out: PlannedImage[] = [];
  const { content } = definition;

  if (content.hero.backgroundImage) {
    out.push({ asset: content.hero.backgroundImage, slot: "hero" });
  }

  if (content.meta.cardImage) {
    // OG cards are always 1200x630 regardless of template.
    out.push({ asset: content.meta.cardImage, slot: "hero" });
  }

  if (content.brand.logo) {
    out.push({ asset: content.brand.logo, slot: "card" });
  }

  for (const section of content.sections) {
    if (!section.enabled) continue;

    if (section.backgroundImage) {
      out.push({ asset: section.backgroundImage, slot: "section" });
    }

    if (section.type === "prose" && section.media) {
      out.push({ asset: section.media, slot: "card" });
    }

    if (section.type === "gallery") {
      for (const image of section.images) out.push({ asset: image, slot: "gallery" });
    }

    if (section.type === "cards") {
      for (const card of section.cards) {
        if (card.image) out.push({ asset: card.image, slot: "card" });
      }
    }
  }

  return out;
}

/** Widths emitted per published image. Matches the upload variant ladder. */
const PUBLISH_WIDTHS = [2400, 1200, 600] as const;

export interface MediaPlan {
  entries: AssetMediaEntry[];
  /**
   * assetId -> published path for the largest crop, e.g. "/media/hero.a3f9c2.webp".
   * Templates resolve through ctx.imageUrl(), which reads this.
   */
  urlMap: Map<string, string>;
  /** assetId -> srcset string, for templates that want responsive images. */
  srcsetMap: Map<string, string>;
  warnings: string[];
}

/**
 * Plan the publish-time crops.
 *
 * Crops happen HERE rather than at upload because they depend on the focal
 * point, which the author edits after uploading. Regenerating on every focal
 * nudge would be wasteful; the form previews crops in pure CSS instead.
 */
export function planMedia(
  definition: SiteDefinition,
  manifest: TemplateManifest,
  s3Prefix: string,
): MediaPlan {
  const entries: AssetMediaEntry[] = [];
  const urlMap = new Map<string, string>();
  const srcsetMap = new Map<string, string>();
  const warnings: string[] = [];
  const seen = new Set<string>();

  for (const { asset, slot } of collectImages(definition)) {
    // The same asset can appear twice (hero image reused as the OG card).
    // Plan it once; the first slot wins.
    if (seen.has(asset.id)) continue;
    seen.add(asset.id);

    if (!asset.stagingKey) {
      warnings.push(`Image ${asset.id} has no staging key and will be skipped.`);
      continue;
    }

    const aspect = manifest.imageAspect[slot] ?? "16/9";
    const sources: string[] = [];

    for (const width of PUBLISH_WIDTHS) {
      // Never upscale past the source, but always emit the smallest width so
      // mobile has something even for a small original.
      if (asset.width && asset.width < width && width !== PUBLISH_WIDTHS.at(-1)) {
        continue;
      }

      const target = asset.width ? Math.min(width, asset.width) : width;

      // Hash over identity + crop parameters, so changing the focal point
      // produces a new filename and the old cached object is never served.
      const hash = sha256Hex(
        `${asset.id}|${asset.stagingKey}|${aspect}|${target}|${asset.focalX}|${asset.focalY}`,
      );

      const file = hashedName(`${slot}-${target}.webp`, hash);
      const destKey = `${s3Prefix}media/${file}`;

      entries.push({
        sourceKey: asset.stagingKey,
        destKey,
        contentType: "image/webp",
        cacheControl: IMMUTABLE,
        transform: {
          aspect,
          width: target,
          focalX: asset.focalX ?? 0.5,
          focalY: asset.focalY ?? 0.5,
        },
      });

      sources.push(`/media/${file} ${target}w`);

      // Largest wins as the canonical src.
      if (!urlMap.has(asset.id)) urlMap.set(asset.id, `/media/${file}`);
    }

    if (sources.length > 1) srcsetMap.set(asset.id, sources.join(", "));
  }

  return { entries, urlMap, srcsetMap, warnings };
}

// ============================================================================
// VENDOR COPIES
// ============================================================================

/** Flatten the copy instructions the vendor resolver produced. */
export function planVendorCopies(resolved: ResolvedDependency[]): AssetCopy[] {
  return resolved.flatMap((dep) => dep.copies);
}

// ============================================================================
// URL RESOLUTION
// ============================================================================

/**
 * Build the accessor templates call.
 *
 * In build mode this returns the published, content-hashed path. In preview
 * mode it returns the signed staging URL from the asset itself.
 *
 * Templates MUST go through this rather than reading asset.url, or a preview
 * would embed a signed Supabase URL into the published document — where it
 * expires and starts returning 403 to every visitor.
 */
export function makeImageUrlResolver(
  mode: RenderMode,
  plan: MediaPlan | null,
): (asset: ImageAsset | undefined) => string {
  return (asset) => {
    if (!asset) return "";

    if (mode === "preview" || !plan) {
      return asset.url ?? "";
    }

    const published = plan.urlMap.get(asset.id);
    if (published) return published;

    // Planned but unmapped means the asset had no staging key. Returning empty
    // is correct: an empty background-image renders as the theme colour rather
    // than a broken-image icon.
    return "";
  };
}

// ============================================================================
// INVALIDATION
// ============================================================================

/**
 * Only the document. Everything else is content-hashed and immutable.
 *
 * If this ever grows beyond a handful of entries, something upstream has
 * stopped hashing filenames — that is the bug, not the invalidation list.
 */
export function invalidationPaths(): string[] {
  return ["/", "/index.html"];
}
