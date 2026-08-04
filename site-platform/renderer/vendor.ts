// ============================================================================
// src/site-platform/renderer/vendor.ts
//
// Resolves a template's declared dependencies into concrete emission
// instructions. Moved here from the standalone vendor-registry.ts — it is part
// of the renderer, not a loose file.
//
// TemplateDependency, CssLayer and DependencyStrategy now live in @site/schema,
// since the manifest is where they are declared. Only the RESOLUTION logic and
// the registry row shapes belong here.
//
// Governing rule: authors declare, the platform decides. An author cannot
// introduce a third-party origin into a customer's page, because there is no
// URL field anywhere in TemplateDependency.
// ============================================================================

import type { TemplateDependency, CssLayer } from "@site/schema";
import { CSS_LAYER_ORDER, emitLayerDeclaration } from "@site/schema";
import type { AssetCopy } from "./types";
import { hashedName, IMMUTABLE } from "./assets";

// Re-exported so consumers have one import site for layer handling.
export { CSS_LAYER_ORDER, emitLayerDeclaration };

// ============================================================================
// REGISTRY SHAPES
// ============================================================================

export type DependencyKind =
  | "stylesheet" | "script" | "font" | "iconset" | "polyfill";

export type DependencyStrategy = "inline" | "copy" | "shared" | "external";

export interface VendorFile {
  /** Relative to `_vendor/{id}@{version}/`, or absolute for `external`. */
  path: string;
  /** sha384 SRI hash, verified against object bytes at registry ingest. */
  integrity: string;
  contentType: string;
  /** The entry point; the rest are its dependencies (fonts, sourcemaps). */
  entry?: boolean;
}

export interface VendorPackageVersion {
  version: string;
  files: VendorFile[];
  /** Iconsets only: name -> { viewBox, path }, for inline subsetting. */
  glyphs?: Record<string, { viewBox: string; path: string }>;
  /** Fonts only: lets selectFiles() ship only declared weights. */
  faces?: Array<{
    family: string;
    weight: number;
    style: "normal" | "italic";
    subset: string;
    path: string;
  }>;
  advisories?: Array<{
    id: string;
    severity: "low" | "moderate" | "high" | "critical";
    url: string;
  }>;
  addedAt: string;
}

export interface VendorPackage {
  id: string;
  displayName: string;
  kind: DependencyKind;
  versions: VendorPackageVersion[];
  allowedStrategies: DependencyStrategy[];
  license: {
    spdx: string;
    requiresAttribution: boolean;
    attributionText?: string;
    noticeUrl?: string;
  };
  deprecated?: boolean;
  replacedBy?: string;
}

export interface ResolveContext {
  /** S3 prefix for the site, so copy destinations land in the right place. */
  siteId: string;
  registry: Map<string, VendorPackage>;
  /**
   * Icon names actually found in the rendered markup. Preferred over the
   * declared list because authors reliably forget to prune it.
   */
  detectedIcons?: string[];
  /** Builds fail against versions with advisories at or above this level. */
  advisoryThreshold?: "moderate" | "high" | "critical";
}

export interface ResolvedDependency {
  packageId: string;
  version: string;
  strategy: DependencyStrategy;
  /** Markup for <head>: link tags, inline sprite, script tags. */
  headMarkup: string;
  copies: AssetCopy[];
  /** CSP source expressions this dependency requires. */
  cspSources: Partial<
    Record<"script-src" | "style-src" | "font-src" | "img-src", string[]>
  >;
  attribution?: string;
}

// ============================================================================
// RESOLUTION
// ============================================================================

const SEVERITY_RANK = { low: 0, moderate: 1, high: 2, critical: 3 } as const;

/**
 * Resolve one declared dependency.
 *
 * FAILS CLOSED on every path: unknown package, unpinned version, a strategy the
 * package does not permit, or an open advisory all raise. A silent fallback is
 * how an unvetted origin ends up on a customer's domain.
 */
export function resolveDependency(
  dep: TemplateDependency,
  ctx: ResolveContext,
): ResolvedDependency {
  const pkg = ctx.registry.get(dep.packageId);

  if (!pkg) {
    if (dep.required) {
      throw new Error(`Unknown vendor package "${dep.packageId}" — not in registry.`);
    }
    return empty(dep);
  }

  if (!pkg.allowedStrategies.includes(dep.strategy)) {
    throw new Error(
      `Package "${dep.packageId}" does not permit strategy "${dep.strategy}". ` +
      `Allowed: ${pkg.allowedStrategies.join(", ")}.`,
    );
  }

  const version = pkg.versions.find((v) => v.version === dep.version);
  if (!version) {
    throw new Error(
      `Version "${dep.version}" of "${dep.packageId}" is not in the registry. ` +
      `Available: ${pkg.versions.map((v) => v.version).join(", ") || "(none)"}.`,
    );
  }

  // Block known-vulnerable versions before anything reaches a customer domain.
  const threshold = ctx.advisoryThreshold ?? "high";
  const blocking = (version.advisories ?? []).filter(
    (a) => SEVERITY_RANK[a.severity] >= SEVERITY_RANK[threshold],
  );

  if (blocking.length > 0) {
    throw new Error(
      `"${dep.packageId}@${dep.version}" has open advisories: ` +
      blocking.map((a) => `${a.id} (${a.severity})`).join(", "),
    );
  }

  switch (dep.strategy) {
    case "inline":   return resolveInline(dep, pkg, version, ctx);
    case "copy":     return resolveCopy(dep, pkg, version, ctx);
    case "shared":   return resolveShared(dep, pkg, version);
    case "external": return resolveExternal(dep, pkg, version);
  }
}

/**
 * Inline — currently the icon-subset path.
 *
 * Emits an SVG symbol sprite containing only referenced glyphs. Four social
 * icons cost ~2KB inline versus ~100KB of stylesheet plus a webfont. Icons
 * inherit currentColor, so they theme from CSS variables with no per-instance
 * style attributes.
 */
function resolveInline(
  dep: TemplateDependency,
  pkg: VendorPackage,
  version: VendorPackageVersion,
  ctx: ResolveContext,
): ResolvedDependency {
  if (pkg.kind !== "iconset" || !version.glyphs) {
    throw new Error(`Inline strategy is only implemented for iconsets ("${pkg.id}").`);
  }

  const wanted = [...new Set(ctx.detectedIcons ?? dep.icons ?? [])];
  const missing = wanted.filter((name) => !version.glyphs![name]);

  if (missing.length > 0 && dep.required) {
    throw new Error(
      `Icons not found in ${pkg.id}@${version.version}: ${missing.join(", ")}`,
    );
  }

  const symbols = wanted
    .filter((name) => version.glyphs![name])
    .map((name) => {
      const g = version.glyphs![name]!;
      return `<symbol id="i-${name}" viewBox="${g.viewBox}"><path d="${g.path}"/></symbol>`;
    })
    .join("");

  return {
    packageId: pkg.id,
    version: version.version,
    strategy: "inline",
    // display:none keeps the sprite out of layout; aria-hidden keeps it out of
    // the accessibility tree. The <use> references still render normally.
    headMarkup: symbols
      ? `<svg xmlns="http://www.w3.org/2000/svg" style="display:none" aria-hidden="true">${symbols}</svg>`
      : "",
    copies: [],
    cspSources: {},   // inline SVG needs no CSP relaxation
    attribution: pkg.license.requiresAttribution
      ? pkg.license.attributionText
      : undefined,
  };
}

/**
 * Copy — vendor files land in the site's own prefix, content-hashed.
 *
 * Same-origin, so no CORS on fonts and no extra DNS/TLS handshake on the
 * critical path. Hashed filenames make these immutable, so they never need
 * invalidating.
 */
function resolveCopy(
  dep: TemplateDependency,
  pkg: VendorPackage,
  version: VendorPackageVersion,
  ctx: ResolveContext,
): ResolvedDependency {
  const files = selectFiles(dep, pkg, version);
  if (files.length === 0) return empty(dep);

  const copies: AssetCopy[] = files.map((f) => ({
    sourceKey: `_vendor/${pkg.id}@${version.version}/${f.path}`,
    destKey: `${ctx.siteId}assets/${hashedName(f.path, f.integrity)}`,
    contentType: f.contentType,
    cacheControl: IMMUTABLE,
  }));

  const entry = files.find((f) => f.entry) ?? files[0]!;
  const href = `/assets/${hashedName(entry.path, entry.integrity)}`;
  const layer: CssLayer = dep.cssLayer ?? "vendor";

  let headMarkup = "";

  if (pkg.kind === "stylesheet" || pkg.kind === "iconset") {
    // layer= on <link> assigns the sheet without the author wrapping it.
    headMarkup = `<link rel="stylesheet" href="${href}" layer="${layer}">`;
    if (dep.preload) {
      headMarkup = `<link rel="preload" as="style" href="${href}">${headMarkup}`;
    }
  } else if (pkg.kind === "script" || pkg.kind === "polyfill") {
    const loading = dep.scriptLoading ?? "defer";
    const attr = loading === "module" ? `type="module"` : loading;
    headMarkup = `<script src="${href}" ${attr}></script>`;
  } else if (pkg.kind === "font") {
    // Self-hosted @font-face, replacing the dead @import in the original
    // template — and avoiding transmitting visitor IPs to a third-party CDN.
    headMarkup = buildFontFaces(pkg, version, files, dep.preload ?? false);
  }

  return {
    packageId: pkg.id,
    version: version.version,
    strategy: "copy",
    headMarkup,
    copies,
    cspSources: {},   // 'self' only — the entire point of copying in
    attribution: pkg.license.requiresAttribution
      ? pkg.license.attributionText
      : undefined,
  };
}

/**
 * Emit @font-face rules plus an optional preload for the primary face.
 *
 * font-display: swap so text is visible during load rather than invisible —
 * on a one-page site, a FOIT is most of the content.
 *
 * Only the first face is preloaded. Preloading every weight competes for
 * bandwidth with the hero image and usually makes LCP worse.
 */
function buildFontFaces(
  pkg: VendorPackage,
  version: VendorPackageVersion,
  files: VendorFile[],
  preload: boolean,
): string {
  const byPath = new Map(files.map((f) => [f.path, f]));
  const parts: string[] = [];

  const faces = (version.faces ?? []).filter((face) => byPath.has(face.path));
  if (faces.length === 0) return "";

  if (preload) {
    const first = byPath.get(faces[0]!.path)!;
    parts.push(
      `<link rel="preload" as="font" type="font/woff2" ` +
      `href="/assets/${hashedName(first.path, first.integrity)}" crossorigin>`,
    );
  }

  const rules = faces
    .map((face) => {
      const file = byPath.get(face.path)!;
      return `@font-face{font-family:'${face.family}';font-style:${face.style};` +
        `font-weight:${face.weight};font-display:swap;` +
        `src:url('/assets/${hashedName(file.path, file.integrity)}') format('woff2');}`;
    })
    .join("");

  parts.push(`<style>${rules}</style>`);
  return parts.join("");
}

/** Shared — /vendor/* routed to a shared bucket by a second CloudFront origin. */
function resolveShared(
  dep: TemplateDependency,
  pkg: VendorPackage,
  version: VendorPackageVersion,
): ResolvedDependency {
  const files = selectFiles(dep, pkg, version);
  if (files.length === 0) return empty(dep);

  const entry = files.find((f) => f.entry) ?? files[0]!;
  const href = `/vendor/${pkg.id}@${version.version}/${entry.path}`;
  const layer: CssLayer = dep.cssLayer ?? "vendor";

  return {
    packageId: pkg.id,
    version: version.version,
    strategy: "shared",
    headMarkup:
      pkg.kind === "script" || pkg.kind === "polyfill"
        ? `<script src="${href}" ${dep.scriptLoading ?? "defer"}></script>`
        : `<link rel="stylesheet" href="${href}" layer="${layer}">`,
    copies: [],       // the distribution routes to the shared prefix
    cspSources: {},   // still same-origin from the browser's perspective
    attribution: pkg.license.requiresAttribution
      ? pkg.license.attributionText
      : undefined,
  };
}

/**
 * External — third-party origin. SRI mandatory, origin added to the CSP.
 *
 * Treat any use of this in a template PR as a finding needing justification,
 * not a default. On a page displaying a contract address next to a copy button,
 * a compromised third-party script is the whole threat model.
 */
function resolveExternal(
  dep: TemplateDependency,
  pkg: VendorPackage,
  version: VendorPackageVersion,
): ResolvedDependency {
  const entry = version.files.find((f) => f.entry) ?? version.files[0];

  if (!entry) {
    throw new Error(`External dependency "${pkg.id}" has no files.`);
  }
  if (!entry.integrity) {
    throw new Error(`External dependency "${pkg.id}" has no SRI hash; refusing to emit.`);
  }

  let origin: string;
  try {
    origin = new URL(entry.path).origin;
  } catch {
    throw new Error(
      `External dependency "${pkg.id}" file path must be an absolute URL, got "${entry.path}".`,
    );
  }

  const isScript = pkg.kind === "script" || pkg.kind === "polyfill";

  return {
    packageId: pkg.id,
    version: version.version,
    strategy: "external",
    headMarkup: isScript
      ? `<script src="${entry.path}" integrity="${entry.integrity}" crossorigin="anonymous" defer></script>`
      : `<link rel="stylesheet" href="${entry.path}" integrity="${entry.integrity}" crossorigin="anonymous">`,
    copies: [],
    cspSources: isScript
      ? { "script-src": [origin] }
      : { "style-src": [origin], "font-src": [origin] },
    attribution: pkg.license.requiresAttribution
      ? pkg.license.attributionText
      : undefined,
  };
}

// ============================================================================
// HELPERS
// ============================================================================

function empty(dep: TemplateDependency): ResolvedDependency {
  return {
    packageId: dep.packageId,
    version: dep.version,
    strategy: dep.strategy,
    headMarkup: "",
    copies: [],
    cspSources: {},
  };
}

/** Narrow a package's file list to what the declaration actually needs. */
function selectFiles(
  dep: TemplateDependency,
  pkg: VendorPackage,
  version: VendorPackageVersion,
): VendorFile[] {
  if (pkg.kind !== "font" || !version.faces) return version.files;

  const weights = dep.weights ?? [400, 700];
  const styles = dep.styles ?? ["normal"];
  const subsets = dep.subsets ?? ["latin"];

  const keep = new Set(
    version.faces
      .filter(
        (f) =>
          weights.includes(f.weight) &&
          styles.includes(f.style) &&
          subsets.includes(f.subset),
      )
      .map((f) => f.path),
  );

  return version.files.filter((f) => keep.has(f.path) || f.entry);
}

// ============================================================================
// CSP
// ============================================================================

/**
 * Assemble the Content-Security-Policy from the resolved dependency set.
 *
 * Defaults are deliberately tight. script-src takes explicit hashes rather than
 * 'unsafe-inline' — which is why the copy-to-clipboard handler had to move out
 * of an onclick attribute and into a hashed <script>.
 *
 * style-src keeps 'unsafe-inline' because the token block and per-section
 * background custom properties are inline styles. Removing it would require
 * nonces on every style attribute, which is not worth the complexity for CSS.
 */
export function buildCsp(
  resolved: ResolvedDependency[],
  inlineScriptHashes: string[] = [],
): string {
  const merge = (key: keyof ResolvedDependency["cspSources"]) => [
    ...new Set(resolved.flatMap((r) => r.cspSources[key] ?? [])),
  ];

  const directives: Record<string, string[]> = {
    "default-src": ["'self'"],
    "script-src": [
      "'self'",
      ...inlineScriptHashes.map((h) => `'${h}'`),
      ...merge("script-src"),
    ],
    "style-src": ["'self'", "'unsafe-inline'", ...merge("style-src")],
    "font-src": ["'self'", "data:", ...merge("font-src")],
    "img-src": ["'self'", "data:", "https:", ...merge("img-src")],
    "connect-src": ["'self'"],
    "frame-ancestors": ["'none'"],
    "base-uri": ["'none'"],
    "object-src": ["'none'"],
    "form-action": ["'self'"],
    "upgrade-insecure-requests": [],
  };

  return Object.entries(directives)
    .map(([key, values]) => (values.length ? `${key} ${values.join(" ")}` : key))
    .join("; ");
}