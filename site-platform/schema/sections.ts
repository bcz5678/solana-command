
import { z } from "zod";
import { field } from './field-meta';
import { ImageAssetSchema, CrossAlignSchema, SiteCtaSchema } from "./primitives";

/** Bump on any breaking shape change. Persisted with every stored payload. */
export const SCHEMA_VERSION = 1 as const;



// ============================================================================
// SECTION 3 — src/sections.ts
// ============================================================================

export const SectionTypeSchema = z.enum([
  "prose", "stats", "timeline", "gallery", "faq", "embed", "cards",
]);
export type SectionType = z.infer<typeof SectionTypeSchema>;

/**
 * Fields carried by every section regardless of type.
 *
 * `id` is identity, `order` is sequence. Array position is neither — it is a
 * rendering artifact. Conflating them means reordering in the form silently
 * reassigns identity, breaking anchors and per-section uploads.
 */
const SectionBaseShape = {
  /** UUID assigned at creation. Never regenerated, never reused. */
  id: z.string().uuid(),

  /**
   * Anchor fragment. DERIVED via assignSlugs() — never authored directly.
   * Used for BOTH the element id and the nav href; deriving them separately is
   * how anchors silently stop resolving.
   */
  slug: z.string(),

  order: z.number().int().nonnegative(),

  /** Soft-hide. Preserves content while removing the section from output. */
  enabled: z.boolean().default(true),

  navLabel: field(z.string().min(1), {
    label: "Nav label", widget: "text", group: "Navigation", order: 1,
    help: "Also used to generate the section's anchor link.",
  }),
  showInNav: field(z.boolean().default(true), {
    label: "Show in navigation", widget: "toggle", group: "Navigation", order: 2,
  }),

  kicker: field(z.string().optional(), {
    label: "Kicker", widget: "text", group: "Content", order: 1,
    help: "Small eyebrow text above the heading.",
  }),
  title: field(z.string().min(1), {
    label: "Heading", widget: "text", group: "Content", order: 2,
  }),

  backgroundImage: ImageAssetSchema.optional(),

  /**
   * Scrim alpha over backgroundImage. Bright photos need ~0.6, already-dark
   * ones ~0.1. A single global value is why generated sites end up with
   * unreadable hero text.
   */
  overlayOpacity: field(z.number().min(0).max(1).optional(), {
    label: "Image overlay", widget: "number", group: "Appearance",
    help: "Higher values darken the background image, improving text contrast.",
  }),

  backgroundColor: field(z.string().optional(), {
    label: "Background colour", widget: "color", group: "Appearance",
    help: "Used when no background image is set.",
  }),

  /**
   * Alignment along the CROSS axis. Reads as left/centre/right in a vertical
   * template and top/middle/bottom in a horizontal one — naming by axis keeps
   * it meaningful in both.
   */
  crossAlign: CrossAlignSchema.default("start"),
};

export const ProseSectionSchema = z.object({
  ...SectionBaseShape,
  type: z.literal("prose"),
  /** One <p> per entry. Replaces divN_text_1 / divN_text_2 style parallel keys. */
  body: field(z.array(z.string()).default([]), {
    label: "Paragraphs", widget: "repeater", group: "Content", order: 3,
  }),
  cta: SiteCtaSchema.optional(),
  /** Inline media, distinct from the full-bleed backgroundImage. */
  media: ImageAssetSchema.optional(),
});

export const StatsSectionSchema = z.object({
  ...SectionBaseShape,
  type: z.literal("stats"),
  intro: z.string().optional(),
  stats: z.array(z.object({
    id: z.string(),
    /** String, not number — "∞", "TBA" and "1,000,000" are all valid. */
    value: field(z.string(), { label: "Value", widget: "text" }),
    label: field(z.string(), { label: "Label", widget: "text" }),
    suffix: z.string().optional(),
  })).default([]),
});

export const TimelineSectionSchema = z.object({
  ...SectionBaseShape,
  type: z.literal("timeline"),
  intro: z.string().optional(),
  milestones: z.array(z.object({
    id: z.string(),
    marker: field(z.string(), { label: "Marker", widget: "text", help: "e.g. Q1 2026" }),
    title: z.string(),
    body: z.string().optional(),
    status: z.enum(["done", "active", "upcoming"]).default("upcoming"),
  })).default([]),
});

export const GallerySectionSchema = z.object({
  ...SectionBaseShape,
  type: z.literal("gallery"),
  intro: z.string().optional(),
  images: z.array(ImageAssetSchema).default([]),
  /** Presentation hint the template MAY honour or ignore. */
  layout: z.enum(["grid", "carousel", "masonry"]).default("grid"),
});

export const FaqSectionSchema = z.object({
  ...SectionBaseShape,
  type: z.literal("faq"),
  intro: z.string().optional(),
  items: z.array(z.object({
    id: z.string(),
    question: z.string(),
    answer: z.string(),
  })).default([]),
});

export const EmbedSectionSchema = z.object({
  ...SectionBaseShape,
  type: z.literal("embed"),
  /** Validate against an allowlist before rendering — this becomes an iframe. */
  embedUrl: field(z.string().url(), { label: "Embed URL", widget: "url" }),
  /** Required: iframes need an accessible name. */
  embedTitle: field(z.string().min(1), { label: "Embed title", widget: "text" }),
  aspectRatio: z.string().default("16/9"),
});

export const CardsSectionSchema = z.object({
  ...SectionBaseShape,
  type: z.literal("cards"),
  intro: z.string().optional(),
  cards: z.array(z.object({
    id: z.string(),
    title: z.string(),
    body: z.string().optional(),
    image: ImageAssetSchema.optional(),
    cta: SiteCtaSchema.optional(),
  })).default([]),
});

export const SiteSectionSchema = z.discriminatedUnion("type", [
  ProseSectionSchema,
  StatsSectionSchema,
  TimelineSectionSchema,
  GallerySectionSchema,
  FaqSectionSchema,
  EmbedSectionSchema,
  CardsSectionSchema,
]);
export type SiteSection = z.infer<typeof SiteSectionSchema>;

/** Section list with structural invariants enforced at parse time. */
export const SiteSectionListSchema = z.array(SiteSectionSchema).superRefine((list, ctx) => {
  const ids = new Set<string>();
  const slugs = new Set<string>();

  for (const [i, section] of list.entries()) {
    if (ids.has(section.id)) {
      ctx.addIssue({
        code: "custom", path: [i, "id"],
        message: `Duplicate section id "${section.id}".`,
      });
    }
    ids.add(section.id);

    // Slugs are generated by assignSlugs(); a collision here means the
    // generator was bypassed, which would produce duplicate element ids.
    if (slugs.has(section.slug)) {
      ctx.addIssue({
        code: "custom", path: [i, "slug"],
        message: `Duplicate slug "${section.slug}" — run assignSlugs() before persisting.`,
      });
    }
    slugs.add(section.slug);
  }
});