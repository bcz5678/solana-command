// ============================================================================
// vendor-registry.ts
//
// Support-file handling for multi-author templates.
//
// Governing rules:
//   1. Authors DECLARE dependencies; they never emit <link>/<script> tags.
//      The platform decides how each dependency is materialized.
//   2. Only registry-listed packages ship. An author cannot introduce an
//      arbitrary third-party origin into a customer's page.
//   3. Published sites are self-contained. Every asset resolves same-origin
//      from the site's own S3 prefix, or is inlined into the document.
//
// Rationale for (3): HTTP cache partitioning means a shared asset CDN no
// longer produces cross-site cache hits, so the only things a shared origin
// still buys you are storage savings (negligible) and central patching —
// paid for with an extra DNS+TLS round trip, font CORS, and uptime coupling.
// ============================================================================

// ============================================================================
// SECTION 1 — REGISTRY
// ============================================================================

export type DependencyKind =
  | "stylesheet"
  | "script"
  | "font"
  | "iconset"
  | "polyfill";

/**
 * How a dependency is materialized at build time.
 *
 *  inline   — embedded in the document. Zero requests. Icons, critical CSS.
 *  copy     — content-hashed into s3://bucket/{site_id}/assets/. Same-origin.
 *  shared   — served from /vendor/* via a second CloudFront origin pointing at
 *             a shared bucket prefix. Same-origin to the browser (no CORS, no
 *             extra handshake) with one stored copy. Costs per-distribution
 *             provisioning and gives up per-site reproducibility.
 *  external — third-party origin. Escape hatch only. Requires an SRI hash and
 *             an explicit CSP allowlist entry. Expect this to be rejected in
 *             template review for anything customer-facing.
 */
export type DependencyStrategy = "inline" | "copy" | "shared" | "external";

/**
 * A package the platform has vetted. Rows live in Supabase (`vendor_packages`)
 * so the registry can be updated without a deploy; this type is the contract
 * the row is validated against on read.
 */
export interface VendorPackage {
  /** Stable registry key referenced by templates, e.g. "fontawesome-brands". */
  id: string;
  displayName: string;
  kind: DependencyKind;

  /** Semver versions available. Templates pin exactly one. */
  versions: VendorPackageVersion[];

  /**
   * Licence obligations that must be discharged in generated output.
   * Font Awesome Free, for example, splits across CC BY 4.0 (icons),
   * SIL OFL 1.1 (fonts) and MIT (code) — CC BY carries an attribution
   * requirement that matters more when you subset individual glyphs than
   * when you ship the vendor's own CSS with its embedded notice.
   */
  license: {
    spdx: string;
    requiresAttribution: boolean;
    /** Emitted into the site footer and/or an HTML comment when required. */
    attributionText?: string;
    noticeUrl?: string;
  };

  /** Strategies this package supports. `inline` only makes sense for some. */
  allowedStrategies: DependencyStrategy[];

  /** Set false to block new templates from adopting it without breaking old ones. */
  deprecated?: boolean;
  replacedBy?: string;
}

export interface VendorPackageVersion {
  version: string;

  /**
   * Canonical objects in the shared bucket, e.g.
   *   _vendor/fontawesome-brands@6.5.2/brands.css
   * Builds S3-CopyObject from here — server-side, so bytes never transit
   * the build worker.
   */
  files: Array<{
    path: string;
    /** sha384 SRI hash. Verified on registry ingest, emitted for `external`. */
    integrity: string;
    /** Emitted as Content-Type on the copied object. */
    contentType: string;
    /** Marks the entry point; the rest are dependencies of it (fonts, maps). */
    entry?: boolean;
  }>;

  /**
   * For iconsets: the extractable glyph table, so the build can subset without
   * parsing the vendor CSS. Keyed by icon name -> { viewBox, path }.
   */
  glyphs?: Record<string, { viewBox: string; path: string }>;

  /** For font packages: which faces exist, so `weights`/`subsets` can be validated. */
  faces?: Array<{
    family: string;
    weight: number;
    style: "normal" | "italic";
    subset: string;
    path: string;
  }>;

  addedAt: string;
  /** Security advisories against this exact version. Blocks new builds. */
  advisories?: Array<{ id: string; severity: "low" | "moderate" | "high" | "critical"; url: string }>;
}

// ============================================================================
// SECTION 2 — TEMPLATE DECLARATIONS
// ============================================================================

/**
 * What a template author writes. Note there is no URL field — authors cannot
 * introduce an origin. They reference a registry id and a pinned version.
 */
export interface TemplateDependency {
  /** Must exist in the registry. Build fails closed if it does not. */
  packageId: string;
  /** Exact version pin. No ranges — reproducibility beats convenience here. */
  version: string;

  /** Must appear in the package's allowedStrategies. */
  strategy: DependencyStrategy;

  /**
   * If false, a missing/deprecated package degrades gracefully: the build
   * emits a warning and the template renders without it. Required deps fail
   * the build instead.
   */
  required: boolean;

  // ---- Subsetting ----

  /**
   * Iconsets: the exact glyphs used. Shipping four social icons should cost
   * ~2KB of inline SVG, not 100KB+ of CSS plus a webfont.
   *
   * Can be authored explicitly OR derived by scanning rendered output for
   * icon references — deriving is more reliable, since authors forget to
   * update the list.
   */
  icons?: string[];

  /** Fonts: restrict to faces actually used. Every extra weight is a request. */
  weights?: number[];
  styles?: Array<"normal" | "italic">;
  subsets?: string[];

  // ---- Emission control ----

  /** Cascade layer this package's CSS is assigned to. See CSS_LAYER_ORDER. */
  cssLayer?: CssLayer;
  /** Preload the entry file. Reserve for genuinely render-blocking assets. */
  preload?: boolean;
  /** Scripts: defer is the default; set to "module" or "async" as needed. */
  scriptLoading?: "defer" | "async" | "module";
}

/**
 * Declared cascade layer order, emitted once at the top of every generated
 * stylesheet.
 *
 * This is the fix for multi-author specificity collisions: a vendor stylesheet
 * placed in the `vendor` layer cannot outrank template styles no matter how
 * specific its selectors are. Authors are required to wrap their CSS in
 * `@layer template { ... }`.
 */
export type CssLayer = "reset" | "vendor" | "tokens" | "template" | "overrides";

export const CSS_LAYER_ORDER: CssLayer[] = [
  "reset",      // normalize / box-sizing
  "vendor",     // registry packages
  "tokens",     // :root { --st-* } from the flattened theme
  "template",   // author CSS
  "overrides",  // per-site escape hatches from the creation form
];

export function emitLayerDeclaration(): string {
  return `@layer ${CSS_LAYER_ORDER.join(", ")};`;
}

// ============================================================================
// SECTION 3 — RESOLUTION OUTPUT
// ============================================================================

/**
 * Produced by the Next.js render endpoint alongside the HTML string, and
 * consumed by the n8n orchestrator to perform the S3 copies.
 *
 * The render step decides WHAT needs to exist; the orchestrator makes it exist.
 * Keeping that boundary clean means the renderer stays a pure function and is
 * trivially testable.
 */
export interface AssetManifest {
  /** Copy operations: server-side S3 CopyObject, shared prefix -> site prefix. */
  copies: Array<{
    sourceKey: string;      // _vendor/fontawesome-brands@6.5.2/brands.css
    destKey: string;        // {site_id}/assets/brands.a3f9c2.css
    contentType: string;
    cacheControl: string;   // immutable for hashed names
  }>;

  /** Media derivatives already generated at upload; copied from staging. */
  media: Array<{
    sourceUrl: string;      // Supabase Storage staging URL
    destKey: string;
    contentType: string;
    cacheControl: string;
  }>;

  /**
   * Paths CloudFront must invalidate. With content-hashed assets this should
   * be exactly ["/", "/index.html"] — CloudFront bills past 1,000 paths per
   * month per account, which `/*` on every rebuild will burn through fast.
   */
  invalidationPaths: string[];

  /** Assembled from the resolved dependency set; emitted as a response header. */
  csp: string;

  /** Attribution obligations to render in the footer. */
  attributions: string[];

  /** Non-fatal problems: optional dep missing, deprecated package, etc. */
  warnings: string[];
}

// ============================================================================
// SECTION 4 — RESOLUTION
// ============================================================================

export interface ResolveContext {
  siteId: string;
  /** Registry rows, prefetched and keyed by packageId. */
  registry: Map<string, VendorPackage>;
  /** Icon names actually referenced in the rendered HTML, if scanned. */
  detectedIcons?: string[];
  /** Block builds against packages with open advisories at/above this level. */
  advisoryThreshold?: "moderate" | "high" | "critical";
}

export interface ResolvedDependency {
  packageId: string;
  version: string;
  strategy: DependencyStrategy;
  /** Markup to inject into <head>, or an inline <style>/<svg> block. */
  headMarkup: string;
  /** Copies this dependency contributes to the AssetManifest. */
  copies: AssetManifest["copies"];
  /** CSP source expressions this dependency requires. */
  cspSources: Partial<Record<"script-src" | "style-src" | "font-src" | "img-src", string[]>>;
  attribution?: string;
}

/**
 * Resolve one declared dependency into concrete emission instructions.
 *
 * Fails closed: an unknown package, an unpinned version, a strategy the
 * package does not permit, or an open advisory all raise. A template author
 * cannot accidentally (or deliberately) widen the CSP of a customer's site.
 */
export function resolveDependency(
  dep: TemplateDependency,
  ctx: ResolveContext
): ResolvedDependency {
  const pkg = ctx.registry.get(dep.packageId);

  if (!pkg) {
    if (dep.required) {
      throw new Error(`Unknown vendor package "${dep.packageId}" — not in registry.`);
    }
    return emptyResolution(dep);
  }

  if (!pkg.allowedStrategies.includes(dep.strategy)) {
    throw new Error(
      `Package "${dep.packageId}" does not permit strategy "${dep.strategy}". ` +
      `Allowed: ${pkg.allowedStrategies.join(", ")}.`
    );
  }

  const version = pkg.versions.find((v) => v.version === dep.version);
  if (!version) {
    throw new Error(
      `Version "${dep.version}" of "${dep.packageId}" is not in the registry.`
    );
  }

  // Block on known-vulnerable versions before anything reaches a customer domain.
  const threshold = ctx.advisoryThreshold ?? "high";
  const rank = { low: 0, moderate: 1, high: 2, critical: 3 } as const;
  const blocking = (version.advisories ?? []).filter(
    (a) => rank[a.severity] >= rank[threshold]
  );
  if (blocking.length > 0) {
    throw new Error(
      `"${dep.packageId}@${dep.version}" has open advisories: ` +
      blocking.map((a) => a.id).join(", ")
    );
  }

  switch (dep.strategy) {
    case "inline":
      return resolveInline(dep, pkg, version, ctx);
    case "copy":
      return resolveCopy(dep, pkg, version, ctx);
    case "shared":
      return resolveShared(dep, pkg, version);
    case "external":
      return resolveExternal(dep, pkg, version);
  }
}

/**
 * Inline strategy — currently the icon-subset path.
 *
 * Emits an SVG symbol sprite containing only the referenced glyphs. Icons
 * inherit `currentColor`, so they theme from CSS variables automatically and
 * the per-instance `style="color: ..."` attributes disappear.
 */
function resolveInline(
  dep: TemplateDependency,
  pkg: VendorPackage,
  version: VendorPackageVersion,
  ctx: ResolveContext
): ResolvedDependency {
  if (pkg.kind !== "iconset" || !version.glyphs) {
    throw new Error(`Inline strategy is only implemented for iconsets ("${pkg.id}").`);
  }

  // Prefer icons actually detected in the rendered HTML over the declared list;
  // authors reliably forget to prune the declaration.
  const wanted = Array.from(new Set(ctx.detectedIcons ?? dep.icons ?? []));
  const missing = wanted.filter((name) => !version.glyphs![name]);

  if (missing.length > 0 && dep.required) {
    throw new Error(`Icons not found in ${pkg.id}@${version.version}: ${missing.join(", ")}`);
  }

  const symbols = wanted
    .filter((name) => version.glyphs![name])
    .map((name) => {
      const g = version.glyphs![name];
      return `<symbol id="i-${name}" viewBox="${g.viewBox}"><path d="${g.path}"/></symbol>`;
    })
    .join("");

  return {
    packageId: pkg.id,
    version: version.version,
    strategy: "inline",
    // aria-hidden + display:none keeps the sprite out of the a11y tree and layout.
    headMarkup: symbols
      ? `<svg xmlns="http://www.w3.org/2000/svg" style="display:none" aria-hidden="true">${symbols}</svg>`
      : "",
    copies: [],
    cspSources: {},   // inline SVG needs no CSP relaxation
    attribution: pkg.license.requiresAttribution ? pkg.license.attributionText : undefined,
  };
}

/**
 * Copy strategy — vendor files land in the site's own prefix, content-hashed.
 *
 * Same-origin, so no CORS on fonts and no extra DNS/TLS handshake. Hashed
 * filenames mean these are immutable and never need invalidating.
 */
function resolveCopy(
  dep: TemplateDependency,
  pkg: VendorPackage,
  version: VendorPackageVersion,
  ctx: ResolveContext
): ResolvedDependency {
  const files = selectFiles(dep, pkg, version);

  const copies = files.map((f) => ({
    sourceKey: `_vendor/${pkg.id}@${version.version}/${f.path}`,
    destKey: `${ctx.siteId}/assets/${hashedName(f.path, f.integrity)}`,
    contentType: f.contentType,
    cacheControl: "public, max-age=31536000, immutable",
  }));

  const entry = files.find((f) => f.entry) ?? files[0];
  const entryHref = `/assets/${hashedName(entry.path, entry.integrity)}`;

  let headMarkup = "";
  if (pkg.kind === "stylesheet" || pkg.kind === "iconset") {
    const layer = dep.cssLayer ?? "vendor";
    // `layer=` on <link> assigns the sheet without the author needing to wrap it.
    headMarkup = `<link rel="stylesheet" href="${entryHref}" layer="${layer}">`;
    if (dep.preload) {
      headMarkup = `<link rel="preload" as="style" href="${entryHref}">` + headMarkup;
    }
  } else if (pkg.kind === "script" || pkg.kind === "polyfill") {
    const loading = dep.scriptLoading ?? "defer";
    const attr = loading === "module" ? 'type="module"' : loading;
    headMarkup = `<script src="${entryHref}" ${attr}></script>`;
  } else if (pkg.kind === "font") {
    // Preload only the primary face; preloading every weight is a net loss.
    headMarkup = dep.preload
      ? `<link rel="preload" as="font" type="font/woff2" href="${entryHref}" crossorigin>`
      : "";
  }

  return {
    packageId: pkg.id,
    version: version.version,
    strategy: "copy",
    headMarkup,
    copies,
    // 'self' only — that is the entire point of copying into the site prefix.
    cspSources: {},
    attribution: pkg.license.requiresAttribution ? pkg.license.attributionText : undefined,
  };
}

/** Shared-origin strategy — /vendor/* routed to a shared bucket by CloudFront. */
function resolveShared(
  dep: TemplateDependency,
  pkg: VendorPackage,
  version: VendorPackageVersion
): ResolvedDependency {
  const files = selectFiles(dep, pkg, version);
  const entry = files.find((f) => f.entry) ?? files[0];
  const href = `/vendor/${pkg.id}@${version.version}/${entry.path}`;
  const layer = dep.cssLayer ?? "vendor";

  return {
    packageId: pkg.id,
    version: version.version,
    strategy: "shared",
    headMarkup:
      pkg.kind === "script"
        ? `<script src="${href}" ${dep.scriptLoading ?? "defer"}></script>`
        : `<link rel="stylesheet" href="${href}" layer="${layer}">`,
    copies: [],   // nothing copied; the distribution routes to the shared prefix
    cspSources: {},   // still same-origin from the browser's perspective
    attribution: pkg.license.requiresAttribution ? pkg.license.attributionText : undefined,
  };
}

/**
 * External strategy — third-party origin. SRI is mandatory, and the origin is
 * added to the site's CSP. Treat any use of this in a template PR as a finding
 * that needs justification, not a default.
 */
function resolveExternal(
  dep: TemplateDependency,
  pkg: VendorPackage,
  version: VendorPackageVersion
): ResolvedDependency {
  const entry = version.files.find((f) => f.entry) ?? version.files[0];

  if (!entry.integrity) {
    throw new Error(`External dependency "${pkg.id}" has no SRI hash; refusing to emit.`);
  }

  const url = new URL(entry.path);   // external entries store absolute URLs
  const origin = url.origin;
  const isScript = pkg.kind === "script" || pkg.kind === "polyfill";

  return {
    packageId: pkg.id,
    version: version.version,
    strategy: "external",
    headMarkup: isScript
      ? `<script src="${url.href}" integrity="${entry.integrity}" crossorigin="anonymous" defer></script>`
      : `<link rel="stylesheet" href="${url.href}" integrity="${entry.integrity}" crossorigin="anonymous">`,
    copies: [],
    cspSources: isScript ? { "script-src": [origin] } : { "style-src": [origin], "font-src": [origin] },
    attribution: pkg.license.requiresAttribution ? pkg.license.attributionText : undefined,
  };
}

// ============================================================================
// SECTION 5 — HELPERS
// ============================================================================

function emptyResolution(dep: TemplateDependency): ResolvedDependency {
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
  version: VendorPackageVersion
) {
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
          subsets.includes(f.subset)
      )
      .map((f) => f.path)
  );

  return version.files.filter((f) => keep.has(f.path) || f.entry);
}

/** Content-hashed filename: brands.css + sha384-abc... -> brands.a3f9c2.css */
function hashedName(path: string, integrity: string): string {
  const short = integrity.replace(/^sha\d+-/, "").replace(/[^a-zA-Z0-9]/g, "").slice(0, 8);
  const dot = path.lastIndexOf(".");
  return dot === -1
    ? `${path}.${short}`
    : `${path.slice(0, dot)}.${short}${path.slice(dot)}`;
}

/**
 * Assemble the Content-Security-Policy from the resolved dependency set.
 *
 * Defaults are deliberately tight. Note `script-src` takes explicit hashes for
 * inline scripts rather than 'unsafe-inline' — which means the copy-to-clipboard
 * handler must move out of an onclick attribute and into a hashed <script>.
 * On a page whose job is displaying a contract address next to a copy button,
 * script injection is the whole threat model.
 */
export function buildCsp(
  resolved: ResolvedDependency[],
  inlineScriptHashes: string[] = []
): string {
  const merge = (key: keyof ResolvedDependency["cspSources"]) =>
    Array.from(new Set(resolved.flatMap((r) => r.cspSources[key] ?? [])));

  const directives: Record<string, string[]> = {
    "default-src": ["'self'"],
    "script-src": ["'self'", ...inlineScriptHashes.map((h) => `'${h}'`), ...merge("script-src")],
    "style-src": ["'self'", "'unsafe-inline'", ...merge("style-src")],  // inline :root token block
    "font-src": ["'self'", "data:", ...merge("font-src")],
    "img-src": ["'self'", "data:", "https:", ...merge("img-src")],
    "connect-src": ["'self'"],
    "frame-ancestors": ["'none'"],
    "base-uri": ["'none'"],
    "object-src": ["'none'"],
    "form-action": ["'self'"],
  };

  return Object.entries(directives)
    .map(([k, v]) => `${k} ${v.join(" ")}`)
    .join("; ");
}