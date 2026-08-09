
import { z } from "zod";
import { field } from './field-meta';
import { TextTransformSchema } from "./primitives";

/** Bump on any breaking shape change. Persisted with every stored payload. */
export const SCHEMA_VERSION = 1 as const;



// ============================================================================
// SECTION 4 — src/theme.ts  (three-tier token layering)
// ============================================================================

/**
 * TIER 1 — CORE. Universal primitives every template consumes.
 * Nothing template-shaped may enter this object; that is what Tier 3 is for.
 *
 * Spacing is named by CSS LOGICAL axis, not physical. A vertical one-pager maps
 * block→Y; a side scroller maps block→X. One token set, both templates.
 */
export const CoreTokensSchema = z.object({
  colors: z.object({
    background:  field(z.string(), { label: "Background", widget: "color", group: "Colors", order: 1 }),
    surface:     field(z.string(), { label: "Surface", widget: "color", group: "Colors", order: 2 }),
    primary:     field(z.string(), { label: "Primary", widget: "color", group: "Colors", order: 3 }),
    primaryHover: z.string().optional(),
    /**
     * Text/icons sitting ON TOP of `primary`. Replaces the old
     * text_color / text_color_reverse pair, whose polarity was inverted from
     * what the names implied.
     */
    onPrimary:   field(z.string(), { label: "Text on primary", widget: "color", group: "Colors", order: 4 }),
    secondary:   field(z.string(), { label: "Secondary", widget: "color", group: "Colors", order: 5 }),
    secondaryHover: z.string().optional(),
    onSecondary: z.string().optional(),
    text:        field(z.string(), { label: "Body text", widget: "color", group: "Colors", order: 6 }),
    /** Replaces the hardcoded #e0e0e0 that overrode themed text on every <p>. */
    textMuted:   field(z.string(), { label: "Muted text", widget: "color", group: "Colors", order: 7 }),
    heading:     z.string().optional(),
    border:      field(z.string(), { label: "Borders", widget: "color", group: "Colors", order: 8 }),
    /** Default scrim over section background images. Per-section overridable. */
    overlay:     field(z.string(), { label: "Image overlay", widget: "color", group: "Colors", order: 9 }),
    success: z.string(), warning: z.string(), error: z.string(),
    info: z.string().optional(),
  }),

  typography: z.object({
    fontFamilyBase:    field(z.string(), { label: "Body font", widget: "select", group: "Typography", order: 1 }),
    fontFamilyHeading: z.string().optional(),
    fontFamilyMono:    z.string().optional(),

    baseFontSize: z.string().default("16px"),
    /** Generates --st-font-size-h1..h6. Previously defined but never wired up. */
    scaleRatio:       z.number().default(1.25),
    scaleRatioMobile: z.number().default(0.75),

    fontWeightNormal: z.number().int().default(400),
    fontWeightMedium: z.number().int().optional(),
    fontWeightBold:   z.number().int().default(700),

    lineHeightBase:    z.number().default(1.6),
    lineHeightHeading: z.number().default(1.15),

    letterSpacingTight: z.string().optional(),
    letterSpacingWide:  z.string().optional(),
    headingTransform:   TextTransformSchema.default("none"),
    kickerTransform:    TextTransformSchema.default("uppercase"),
  }),

  spacing: z.object({
    unit: z.string().default("8px"),
    containerMaxInline: z.string().default("1200px"),
    /** The inner `.content` block — was hardcoded at 700px. */
    contentMaxInline:   z.string().default("700px"),
    /** Along the scroll axis. */
    sectionPaddingBlock:  z.string().default("80px"),
    /** Across the scroll axis. */
    sectionPaddingInline: z.string().default("8%"),
    radius:   z.string().default("0px"),
    radiusSm: z.string().optional(),
    radiusLg: z.string().optional(),
  }),

  motion: z.object({
    speed:  z.string().default("0.2s"),
    easing: z.string().default("ease"),
    /** Emits a prefers-reduced-motion override block. */
    respectReducedMotion: z.boolean().default(true),
  }),

  breakpoints: z.object({
    sm: z.string().optional(),
    md: z.string().default("768px"),
    lg: z.string().optional(),
  }),

  shadows: z.object({
    sm: z.string().optional(), md: z.string().optional(), lg: z.string().optional(),
  }).optional(),
});
export type CoreTokens = z.infer<typeof CoreTokensSchema>;

/**
 * TIER 2 — SEMANTIC. Role aliases that RESOLVE FROM core with fallbacks.
 * Templates read these, never raw core values, so swapping a palette touches
 * core only. All optional: resolveTheme() derives any that are absent.
 */
export const SemanticTokensSchema = z.object({
  textOnImage: field(z.string().optional(), {
    label: "Text over images", widget: "color", group: "Semantic", order: 1,
    help: "Used for headings and body text sitting on a background photo.",
  }),
  navBackground: field(z.string().optional(), {
    label: "Header background", widget: "color", group: "Header", order: 1,
  }),
  navForeground: field(z.string().optional(), {
    label: "Header text", widget: "color", group: "Header", order: 2,
  }),
  mobileMenuBackground: field(z.string().optional(), {
    label: "Mobile menu background", widget: "color", group: "Header", order: 3,
  }),
  footerBackground: field(z.string().optional(), {
    label: "Footer background", widget: "color", group: "Footer", order: 1,
  }),
  footerForeground: field(z.string().optional(), {
    label: "Footer text", widget: "color", group: "Footer", order: 2,
  }),
  footerBorder: field(z.string().optional(), {
    label: "Footer divider", widget: "color", group: "Footer", order: 3,
  }),
  surfaceElevated: field(z.string().optional(), {
    label: "Raised surface", widget: "color", group: "Semantic", order: 2,
  }),
  overlayScrim: field(z.string().optional(), {
    label: "Image scrim", widget: "color", group: "Semantic", order: 3,
  }),
});
export type SemanticTokens = z.infer<typeof SemanticTokensSchema>;

/**
 * TIER 3 — TEMPLATE-SCOPED, namespaced by template id.
 *
 * Side-scroller-only knobs (rail width, snap strictness, dot indicator style)
 * live here. This is the pressure valve that stops the shared theme growing
 * into a union of every template's controls, mostly null on any given render.
 * Shape is validated against each template's `customThemeSchema`.
 */
export const TemplateScopedTokensSchema = z.record(
  z.string(),
  z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])),
);

export const LayeredThemeSchema = z.object({
  id: z.string(),
  name: z.string(),
  schemaVersion: z.number().int().default(SCHEMA_VERSION),
  /** Theme inheritance: parent is deep-merged, then this. */
  extends: z.string().optional(),
  mode: z.enum(["light", "dark"]).default("dark"),
  core: CoreTokensSchema,
  semantic: SemanticTokensSchema.optional(),
  templates: TemplateScopedTokensSchema.optional(),
});
export type LayeredTheme = z.infer<typeof LayeredThemeSchema>;