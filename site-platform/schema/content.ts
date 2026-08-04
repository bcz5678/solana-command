
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
  locale: z.string().default("en"),
  themeColor: z.string().optional(),
  /** Generated sites should not be indexed before launch. */
  noindex: z.boolean().default(false),
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
  overlayOpacity: z.number().min(0).max(1).optional(),
  crossAlign: CrossAlignSchema.default("start"),
  /** Plural — templates commonly want a primary plus a secondary action. */
  ctas: z.array(SiteCtaSchema).default([]),
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
    targetIso: z.string(),
    label: z.string().optional(),
    expiredMessage: z.string().optional(),
  }).optional(),

  mailingList: z.object({
    actionUrl: z.string().url(),
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