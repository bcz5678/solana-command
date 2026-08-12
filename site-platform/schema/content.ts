
import { z } from "zod";
import { field } from './field-meta';
import { ImageAssetSchema, CrossAlignSchema, SiteCtaSchema, SocialLinkSchema, } from "./primitives";
import { SiteSectionListSchema } from "./sections";

/** Bump on any breaking shape change. Persisted with every stored payload. */
export const SCHEMA_VERSION = 1 as const;


// ============================================================================
// SECTION 6 — src/content.ts
// ============================================================================

export const SiteMetaSchema = z.object({
  /** Note the spelling: the original template used `fdqn` throughout. */
  fqdn: field(z.string().min(1), { label: "Domain", widget: "text", group: "SEO", order: 1 }),
  title: field(z.string().min(1), { label: "Page title", widget: "text", group: "SEO", order: 2 }),
  description: field(z.string(), { label: "Meta description", widget: "textarea", group: "SEO", order: 3 }),
  keywords: z.string().optional(),
  cardImage: ImageAssetSchema.optional(),
  locale: field(z.string().default("en"), {
    label: "Locale", widget: "text", group: "Settings", order: 1,
    help: "BCP 47 language tag, e.g. en, en-US, fr.",
  }),
  themeColor: z.string().optional(),
  /** Generated sites should not be indexed before launch. */
  noindex: field(z.boolean().default(false), {
    label: "Hide from search engines", widget: "toggle", group: "Settings", order: 2,
  }),
  canonicalUrl: z.string().url().optional(),
});

export const SiteBrandSchema = z.object({
  name: field(z.string().min(1), { label: "Site name", widget: "text", group: "Brand" }),
  /** Lets the header wordmark differ from the SEO site name. */
  logoText: z.string().optional(),
  logo: ImageAssetSchema.optional(),
  faviconUrl: z.string().optional(),
});

export const SiteHeroSchema = z.object({
  kicker: field(z.string().optional(), { label: "Kicker", widget: "text", group: "Hero", order: 1 }),
  title: field(z.string().min(1), { label: "Headline", widget: "text", group: "Hero", order: 2 }),
  /**
   * Authored independently of meta.description. The original template rendered
   * the meta description as a second hero paragraph — copy written for search
   * engines should not double as hero body copy.
   */
  body: field(z.array(z.string()).default([]), {
    label: "Paragraphs", widget: "repeater", group: "Hero", order: 3,
  }),
  backgroundImage: ImageAssetSchema.optional(),
  
  /** Overrides the asset's intrinsic focal for THIS placement only.
  *  Exists because text occlusion is a property of the section, not the image. */
  backgroundFocal: z.object({ x: z.number(), y: z.number() }).optional(),


  overlayOpacity: z.number().min(0).max(1).optional(),
    /**
   * Scrim geometry. `overlayOpacity` remains the PEAK alpha in all cases, so
   * stored rows that predate this field render unchanged under "uniform".
   *
   * "auto" derives the origin from where the text actually sits — see
   * resolveScrimOrigin(). It's the sensible default for new content because the
   * information needed is already in the definition; asking the user to pick a
   * direction that duplicates their own alignment choice is a control that can
   * only be set wrong.
   */
  overlayDirection: z
  .enum(["uniform", "auto", "top", "bottom", "left", "right",
         "top-left", "top-right", "bottom-left", "bottom-right"])
  .default("uniform"),
  crossAlign: CrossAlignSchema.default("start"),
  /** Plural — templates commonly want a primary plus a secondary action. */
  ctas: z.array(SiteCtaSchema).default([]),

  /** Where this template places section copy within the frame. Feeds scrim
  *  origin derivation. A side-scroller anchors differently to a stacked page. */
  contentAnchor: z.enum(["block-start", "block-center", "block-end"])
  .default("block-center"),
});

/**
 * Domain blocks. Kept out of SiteContent's top level so a non-crypto template
 * never carries a dead contractAddress, and the form surfaces only what the
 * selected manifest declares in `supportsModules`.
 */
export const SiteModulesSchema = z.object({
  token: z.object({
    contractAddress: field(z.string(), { label: "Contract address", widget: "text" }),
    chain: z.string().optional(),
    ticker: z.string().optional(),
    /** UI copy — was hardcoded English in the original template. */
    copyLabel: z.string().default("Click to copy"),
    copyConfirmation: z.string().default("Address copied to clipboard"),
    explorerUrl: z.string().url().optional(),
    chartUrl: z.string().url().optional(),
  }).optional(),

  countdown: z.object({
    // Required, and — unlike the optional fields around it — has no default
    // that lets the module render meaningfully without one, so it gets
    // field() metadata; the module is otherwise unconfigurable from the form.
    targetIso: field(z.string(), {
      label: "Target date/time", widget: "text",
      help: "ISO 8601, e.g. 2026-12-31T00:00:00Z.",
    }),
    label: z.string().optional(),
    expiredMessage: z.string().optional(),
  }).optional(),

  mailingList: z.object({
    // Same reasoning as countdown.targetIso: required, no default, otherwise
    // unreachable from the form.
    actionUrl: field(z.string().url(), { label: "Signup form action URL", widget: "url" }),
    placeholder: z.string().default("Email address"),
    submitLabel: z.string().default("Subscribe"),
    successMessage: z.string().optional(),
  }).optional(),
});

export const SiteFooterSchema = z.object({
  /** The entire disclaimer was hardcoded prose in the original template. */
  disclaimer: field(z.string().optional(), {
    label: "Disclaimer", widget: "textarea", group: "Footer",
  }),
  legal: z.object({
    coinName: z.string().optional(),
    companyName: z.string().optional(),
    /** "auto" resolves to the build year. The original hardcoded ©2026. */
    copyrightYear: z.union([z.number().int(), z.literal("auto")]).default("auto"),
  }).optional(),
  links: z.array(z.object({ label: z.string(), href: z.string() })).default([]),
});

export const SiteContentSchema = z.object({
  schemaVersion: z.number().int().default(SCHEMA_VERSION),
  meta: SiteMetaSchema,
  brand: SiteBrandSchema,
  hero: SiteHeroSchema,
  sections: SiteSectionListSchema,
  social: z.array(SocialLinkSchema).default([]),
  modules: SiteModulesSchema.optional(),
  footer: SiteFooterSchema,
});
export type SiteContent = z.infer<typeof SiteContentSchema>;