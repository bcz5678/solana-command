
import { z } from "zod";
import { responsive } from './primitives';
import { SectionTypeSchema } from "./sections";

/** Bump on any breaking shape change. Persisted with every stored payload. */
export const SCHEMA_VERSION = 1 as const;

// ============================================================================
// SECTION 5 — src/manifest.ts
//
// Reconciled with vendor-registry.ts: the manifest now carries the template's
// declared dependencies and its renderer key.
// ============================================================================

export const CssLayerSchema = z.enum([
  "reset", "vendor", "tokens", "template", "overrides",
]);
export type CssLayer = z.infer<typeof CssLayerSchema>;

/** Emitted once at the top of every generated stylesheet. */
export const CSS_LAYER_ORDER: CssLayer[] = [
  "reset", "vendor", "tokens", "template", "overrides",
];

export function emitLayerDeclaration(): string {
  return `@layer ${CSS_LAYER_ORDER.join(", ")};`;
}

export const DependencyStrategySchema = z.enum([
  "inline", "copy", "shared", "external",
]);

/**
 * What a template author declares. Note the absence of a URL field — authors
 * reference a curated registry id and a pinned version. They cannot introduce
 * a third-party origin into a customer's page.
 */
export const TemplateDependencySchema = z.object({
  packageId: z.string(),
  /** Exact pin, no ranges. Reproducibility beats convenience here. */
  version: z.string(),
  strategy: DependencyStrategySchema,
  /** false → a missing package degrades to a warning instead of failing the build. */
  required: z.boolean().default(true),

  /** Iconsets: glyph subset. Overridden by icons detected in rendered output. */
  icons: z.array(z.string()).optional(),

  /** Fonts: restrict to faces actually used. */
  weights: z.array(z.number().int()).optional(),
  styles:  z.array(z.enum(["normal", "italic"])).optional(),
  subsets: z.array(z.string()).optional(),

  cssLayer: CssLayerSchema.default("vendor"),
  preload: z.boolean().default(false),
  scriptLoading: z.enum(["defer", "async", "module"]).default("defer"),
});
export type TemplateDependency = z.infer<typeof TemplateDependencySchema>;

export const TemplateFlowSchema = z.enum(["vertical", "horizontal", "grid"]);

/**
 * The capability contract. This is what lets ONE creation form serve N
 * templates: the form reads the manifest to decide which section types to
 * offer, which fields are required, what crops to request, and which theme
 * controls to disclose.
 */
export const TemplateManifestSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  version: z.string(),
  previewImage: z.string(),

  /** Maps to the TEMPLATES record in packages/site-renderer. */
  rendererKey: z.string(),

  /** Primary scroll axis. Responsive — side scrollers stack below `md`. */
  flow: responsive(TemplateFlowSchema),

  supportedSectionTypes: z.array(SectionTypeSchema).min(1),

  /** Vertical tolerates ~12 sections; horizontal breaks down past ~6. */
  sectionCount: z.object({
    min: z.number().int().nonnegative(),
    max: z.number().int().positive(),
  }),

  supportsModules: z.array(z.string()).default([]),

  /**
   * Dotted content paths the template cannot render without. `[]` means
   * "every element of". e.g. ["hero.title", "sections[].backgroundImage"]
   */
  requiredContent: z.array(z.string()).default([]),

  /** Registry packages this template needs. Resolved at build time. */
  dependencies: z.array(TemplateDependencySchema).default([]),

  /** Target crops per slot. Drives publish-time crop generation AND the
   *  form's CSS focal-point preview, so author and output agree exactly. */
  imageAspect: z.record(z.string(), z.string()).default({}),

  /** Theme paths this template consumes. Drives progressive disclosure. */
  usesThemeKeys: z.array(z.string()).default([]),

  /** Template-only knobs, kept out of the shared theme surface (Tier 3). */
  customThemeSchema: z.record(z.string(), z.object({
    type: z.enum(["color", "length", "number", "select", "boolean"]),
    label: z.string(),
    default: z.unknown(),
    options: z.array(z.string()).optional(),
  })).optional(),

  capabilities: z.object({
    hasStickyNav: z.boolean().default(false),
    hasMobileDrawer: z.boolean().default(false),
    hasScrollSnap: z.boolean().default(false),
    hasProgressIndicator: z.boolean().default(false),
    supportsPerSectionBackground: z.boolean().default(true),
    supportsDarkModeToggle: z.boolean().default(false),
  }).optional(),
});
export type TemplateManifest = z.infer<typeof TemplateManifestSchema>;

/**
 * RENDERER CONTRACT.
 *
 * Template authors return FRAGMENTS, never a document. assembleDocument() in
 * packages/site-renderer owns doctype, meta/OG block, layer declaration, token
 * emission, vendor markup, script hashing and CSP. That ownership is why a
 * careless template cannot ship a page without a CSP or with a broken head.
 */
export const TemplateOutputSchema = z.object({
  /** Extra meta only. The platform emits the standard set. */
  head: z.string().default(""),
  body: z.string(),
  /** Automatically wrapped in @layer template. */
  css: z.string(),
  /** Hashed for CSP by the assembler. No inline event handler attributes. */
  inlineScripts: z.array(z.string()).default([]),
});
export type TemplateOutput = z.infer<typeof TemplateOutputSchema>;