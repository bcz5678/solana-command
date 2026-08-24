// ============================================================================
// tools/template-import/assets.ts
//
// STEP 6 — resolve the local assets a source references against the
// _source/ tree `init --assets` copied in.
//
// A discovered reference becomes one of three things:
//
//   local image   content[sourceUrl] = { seedPath, variants } — read by
//                 author-preset.ts to build a real ImageAsset instead of
//                 leaving backgroundImage undefined.
//   local file    a bundleAssets entry (integrity-hashed) — for fonts, icons
//                 and stylesheets the source ships that aren't themselves
//                 content (Font Awesome, favicons, the web manifest). Also
//                 where an orphaned CSS background lands (a background-image
//                 url() whose selector matched no section, per merge.ts's
//                 orphanBackgrounds) — nothing to attach it to as content, but
//                 the reference still has to resolve, so it's bundled instead.
//   external      not ours to copy. Reported as a finding rather than
//                 silently dropped — an absolute og:image is correct to
//                 leave alone, but it's still missing at publish unless a
//                 reviewer catches it here first.
//
// Variant generation is STUBBED: sharp isn't a dependency yet, so this copies
// the original bytes as the sole variant rather than the real 2400/1200/600
// webp set ImageAssetSchema documents. author-preset.ts already falls back to
// "any available variant" when "1200" isn't present, so nothing downstream
// needs to change when sharp lands — only generateVariant() here does.
//
// Does NOT chase a bundled stylesheet's own internal url() references (Font
// Awesome's fontawesome.css references its own .woff2 files, for instance) —
// those still need adding to bundleAssets by hand. Only what's discoverable
// directly from the HTML — <link>, <img>, OG/twitter meta — is automatic.
// ============================================================================

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, extname } from "node:path";
import { parseHTML } from "linkedom";
import type { AssetRef } from "./css/tokenize-css.js";

// ============================================================================
// TYPES
// ============================================================================

export interface PreparedAsset {
  seedPath: string;
  /** Keyed by width when real, "original" for the stub single-variant case. */
  variants: Record<string, string>;
}

export interface PreparedBundleAsset {
  path: string;
  /** sha384-<base64>, matching BundleAssetSchema. */
  integrity: string;
  contentType: string;
}

export interface PrepareAssetsResult {
  /** Keyed by the original reference: a CSS url(), <img src>, or og:image. */
  content: Record<string, PreparedAsset>;
  bundleAssets: PreparedBundleAsset[];
  warnings: string[];
}

const MIME_TYPES: Record<string, string> = {
  ".css": "text/css",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".ttf": "font/ttf",
  ".otf": "font/otf",
  ".ico": "image/x-icon",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".webmanifest": "application/manifest+json",
  ".json": "application/json",
};

// ============================================================================
// ENTRY POINT
// ============================================================================

export function prepareAssets(
  html: string,
  tokenizeAssets: AssetRef[],
  orphanBackgroundUrls: Set<string>,
  sourceDir: string,
  outDir: string,
): PrepareAssetsResult {
  const { document } = parseHTML(html);

  const content: Record<string, PreparedAsset> = {};
  const bundleAssets: PreparedBundleAsset[] = [];
  const warnings: string[] = [];
  const seenSeedPaths = new Set<string>();

  // ---- Images: CSS backgrounds, <img>, OG/twitter meta ----
  // Orphan backgrounds are excluded here — they have no section to attach an
  // ImageAsset to, so they're bundled below instead, alongside stylesheets
  // and icons, rather than copied into content.
  const imageRefs = new Set<string>();
  for (const asset of tokenizeAssets) {
    if (orphanBackgroundUrls.has(asset.url)) continue;
    imageRefs.add(asset.url);
  }

  for (const img of Array.from(document.querySelectorAll("img"))) {
    const src = img.getAttribute("src");
    if (src) imageRefs.add(src);
  }
  for (const selector of ['meta[property="og:image"]', 'meta[name="twitter:image"]']) {
    const url = document.querySelector(selector)?.getAttribute("content");
    if (url) imageRefs.add(url);
  }

  for (const ref of imageRefs) {
    if (!isLocal(ref)) {
      warnings.push(`Image "${ref}" is external — it will not be copied. Confirm it's meant to stay off-origin.`);
      continue;
    }

    const prepared = copyLocalImage(ref, sourceDir, outDir, seenSeedPaths, warnings);
    if (prepared) content[ref] = prepared;
  }

  // ---- Orphaned CSS backgrounds: no section to attach to, bundled instead ----
  // Same treatment as a linked stylesheet or icon: integrity-hashed and
  // path-preserved, so the source's own relative url() keeps resolving
  // instead of pointing at a content-storage location nothing publishes.
  for (const url of orphanBackgroundUrls) {
    if (!isLocal(url)) {
      warnings.push(`Background "${url}" is external — it will not be bundled.`);
      continue;
    }

    const bundled = bundleLocalFile(url, sourceDir, warnings);
    if (bundled) bundleAssets.push(bundled);
  }

  // ---- Bundle files: stylesheets, icons, the web manifest ----
  for (const link of Array.from(document.querySelectorAll("link"))) {
    const rel = (link.getAttribute("rel") ?? "").toLowerCase();
    if (!/stylesheet|icon|manifest/.test(rel)) continue;

    const href = link.getAttribute("href");
    if (!href) continue;

    if (!isLocal(href)) {
      warnings.push(`Linked file "${href}" (rel="${rel}") is external — it will not be bundled.`);
      continue;
    }

    // Browser-saved pages routinely name a linked stylesheet after the
    // request path rather than a file extension — Chrome's "Save as, webpage
    // complete" saves Google Fonts' CSS as a bare "css2" (the real endpoint
    // is fonts.googleapis.com/css2?...). extname() finds nothing there, and
    // MIME_TYPES falls back to application/octet-stream — which a browser
    // correctly refuses to apply as a stylesheet. rel="stylesheet" is a fact
    // about the file MIME_TYPES can't see from the name alone; trusting it
    // when the extension is silent is more reliable than sniffing content.
    const bundled = bundleLocalFile(
      href, sourceDir, warnings,
      rel.includes("stylesheet") ? "text/css" : undefined,
    );
    if (bundled) bundleAssets.push(bundled);
  }

  return { content, bundleAssets, warnings };
}

/** Absolute, protocol-relative, data:, mailto: and tel: are never ours to copy. */
export function isLocal(url: string): boolean {
  return !/^([a-z][a-z0-9+.-]*:)?\/\//i.test(url) && !/^(data|mailto|tel):/i.test(url);
}

// ============================================================================
// IMAGES
// ============================================================================

function copyLocalImage(
  ref: string,
  sourceDir: string,
  outDir: string,
  seenSeedPaths: Set<string>,
  warnings: string[],
): PreparedAsset | undefined {
  const sourcePath = join(sourceDir, ref);
  if (!existsSync(sourcePath)) {
    warnings.push(`Image "${ref}" was not found under the copied source tree — check --assets pointed at the right directory.`);
    return undefined;
  }

  const bytes = readFileSync(sourcePath);
  const seedPath = uniqueSeedPath(ref, seenSeedPaths);
  const filename = generateVariant(bytes, seedPath, ref, outDir);

  return { seedPath, variants: { original: filename } };
}

/**
 * STUB — copies the original bytes verbatim as the sole variant.
 *
 * Swap for real sharp-based 2400/1200/600 webp generation later; the return
 * contract (seedPath + a variants map with at least one entry) is what
 * author-preset.ts and emit.ts actually depend on, not the key names.
 */
function generateVariant(bytes: Buffer, seedPath: string, ref: string, outDir: string): string {
  const ext = extname(ref) || ".bin";
  const filename = `original${ext}`;

  const destDir = join(outDir, seedPath);
  mkdirSync(destDir, { recursive: true });
  writeFileSync(join(destDir, filename), bytes);

  return filename;
}

function uniqueSeedPath(ref: string, seen: Set<string>): string {
  const base = ref.split("/").pop()?.replace(/\.\w+$/, "").replace(/[^a-zA-Z0-9_-]/g, "-") || "image";

  let candidate = base;
  let i = 2;
  while (seen.has(candidate)) candidate = `${base}-${i++}`;
  seen.add(candidate);

  return candidate;
}

// ============================================================================
// BUNDLE FILES
// ============================================================================

function bundleLocalFile(
  href: string,
  sourceDir: string,
  warnings: string[],
  contentTypeHint?: string,
): PreparedBundleAsset | undefined {
  const sourcePath = join(sourceDir, href);
  if (!existsSync(sourcePath)) {
    warnings.push(`Linked file "${href}" was not found under the copied source tree.`);
    return undefined;
  }

  const bytes = readFileSync(sourcePath);
  const ext = extname(href).toLowerCase();

  return {
    path: href,
    integrity: sriHash(bytes),
    // The hint only ever fills in for an extension MIME_TYPES doesn't
    // recognise — an actual (if unusual) extension still wins, since it's a
    // more specific fact than "this link's rel says stylesheet."
    contentType: MIME_TYPES[ext] ?? contentTypeHint ?? "application/octet-stream",
  };
}

// ============================================================================
// HASHING
// ============================================================================

/** Subresource Integrity format — sha384-<base64>, matching BundleAssetSchema. */
function sriHash(bytes: Buffer): string {
  return `sha384-${createHash("sha384").update(bytes).digest("base64")}`;
}
