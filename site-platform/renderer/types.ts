// ============================================================================
// packages/site-renderer/src/types.ts
//
// The contracts between the platform, template authors, and the orchestrator.
// ============================================================================

import type {
  SiteDefinition,
  SiteSection,
  TemplateManifest,
  ImageAsset,
} from "@site/schema";
import type { ResolvedDependency } from "./vendor.js";

// ============================================================================
// RESOLVED THEME
// ============================================================================

/**
 * A LayeredTheme after inheritance, per-site overrides, semantic fallbacks and
 * type-scale generation have all been applied. Every value is concrete — no
 * optionals, no "falls back to X" left to the template.
 *
 * Templates never read the raw theme; they read CSS variables emitted from
 * this. That is what keeps a template from having to know that
 * `heading` defaults to `text`.
 */
export interface ResolvedTheme {
  /** Flat map of CSS custom property name -> value, e.g. "--st-color-bg". */
  vars: Record<string, string>;
  /** Template-scoped tokens for this template id only (Tier 3). */
  custom: Record<string, string>;
  mode: "light" | "dark";
  /** Retained for logic that cannot be expressed as a CSS variable. */
  raw: {
    breakpointMd: string;
    respectReducedMotion: boolean;
    fontFamilyBase: string;
    fontFamilyHeading: string;
  };
}

// ============================================================================
// TEMPLATE CONTRACT
// ============================================================================

/**
 * What a template author returns. FRAGMENTS, never a document.
 *
 * assembleDocument() owns doctype, the meta/OG block, the @layer declaration,
 * token emission, vendor markup and script hashing. That ownership is why a
 * careless template cannot ship a page with no CSP or a broken head.
 */
export interface TemplateOutput {
  /** Extra <head> content only. The platform emits the standard set. */
  head?: string;
  /** Visible markup. Goes inside <body> verbatim. */
  body: string;
  /** Automatically wrapped in @layer template. */
  css: string;
  /**
   * Inline scripts, without <script> tags. Each is hashed for the CSP.
   * Inline event handler attributes (onclick=) are NOT permitted — they
   * require 'unsafe-inline', which defeats the policy.
   */
  inlineScripts?: string[];
}

/**
 * Everything a template renderer receives. Deliberately pre-chewed: sections
 * are already ordered, filtered and slugged, so no two templates can disagree
 * about ordering semantics.
 */
export interface TemplateContext {
  definition: SiteDefinition;
  manifest: TemplateManifest;
  theme: ResolvedTheme;

  /** Enabled sections, sorted by `order`, with unique slugs assigned. */
  sections: SiteSection[];

  /**
   * Resolve an ImageAsset to the URL that belongs in the output.
   *
   * In build mode this returns the published, content-hashed S3 path. In
   * preview mode it returns the signed staging URL. Templates must always go
   * through this rather than reading `asset.url` directly, or previews will
   * embed staging URLs into published sites.
   */
  imageUrl: (asset: ImageAsset | undefined, slot?: string) => string;

  /** Copyright year, resolved from "auto" at build time. */
  year: number;

  /** Attribution lines from resolved vendor licenses, for the footer. */
  attributions: string[];
}

export type TemplateRenderer = (
  ctx: TemplateContext,
) => TemplateOutput | Promise<TemplateOutput>;

// ============================================================================
// ASSET MANIFEST
// ============================================================================

export interface AssetCopy {
  /** Key in the shared bucket, e.g. `_vendor/inter@4.0/inter-latin-400.woff2` */
  sourceKey: string;
  /** Key in the site prefix, content-hashed. */
  destKey: string;
  contentType: string;
  cacheControl: string;
}

export interface AssetMediaEntry {
  /** Supabase Storage object key (staging). */
  sourceKey: string;
  destKey: string;
  contentType: string;
  cacheControl: string;
  /**
   * Crop instruction for the build worker's sharp pass. Focal-dependent, which
   * is why this happens at publish rather than at upload: nudging the focal
   * point must not regenerate every derivative.
   */
  transform: {
    aspect: string;   // "16/9"
    width: number;
    focalX: number;
    focalY: number;
  };
}

/**
 * What the orchestrator consumes. The renderer decides what must exist; n8n
 * makes it exist. Keeping that boundary clean is what lets the renderer stay a
 * pure function.
 */
export interface AssetManifest {
  copies: AssetCopy[];
  media: AssetMediaEntry[];
  /**
   * Should be exactly ["/", "/index.html"]. Everything else is content-hashed
   * and immutable, so it never needs invalidating — which keeps you under
   * CloudFront's 1,000 free paths per month.
   */
  invalidationPaths: string[];
  csp: string;
  attributions: string[];
  warnings: string[];
  /** sha256 of the rendered document. Change detection and build logging. */
  artifactHash: string;
}

// ============================================================================
// RENDER IO
// ============================================================================

export type RenderMode = "build" | "preview";

export interface RenderInput {
  definition: SiteDefinition;
  manifest: TemplateManifest;
  /** Empty on the icon-detection pass; populated on the final pass. */
  vendor: ResolvedDependency[];
  rendererKey: string;
  /**
   * build   → media rewritten to published S3 paths, crop plan emitted
   * preview → media left as signed staging URLs, no crop plan
   *
   * Defaults to "build". Getting this wrong ships signed Supabase URLs into a
   * customer's published page, where they expire and 403.
   */
  mode?: RenderMode;
  /** S3 prefix for the site, e.g. "uuid/". Required in build mode. */
  s3Prefix?: string;
}

export interface RenderOutput {
  /** The complete document. */
  html: string;
  /** Body fragment only — used by the icon-detection pass. */
  body: string;
  css: string;
  /** CSP source expressions for the inline scripts this render emitted. */
  inlineScriptHashes: string[];
  assetManifest: AssetManifest;
}