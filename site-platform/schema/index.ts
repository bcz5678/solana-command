// ============================================================================
// site-platform/schema/index.ts
//
// Public surface of the schema package.
// ============================================================================

// ---- SECTION 1 — field-meta.ts ----
export { SCHEMA_VERSION } from "./field-meta.js";
export { fieldRegistry, field, getFieldMeta } from "./field-meta.js";
export type { FieldWidget, FieldMeta } from "./field-meta.js";

// ---- SECTION 2 — primitives.ts ----
export {
  responsive,
  CrossAlignSchema,
  TextTransformSchema,
  ImageAssetSchema,
  SiteCtaSchema,
  SocialLinkSchema,
} from "./primitives.js";
export type { CrossAlign, ImageAsset, SiteCta, SocialLink } from "./primitives.js";

// ---- SECTION 3 — sections.ts ----
export {
  SectionTypeSchema,
  ProseSectionSchema,
  StatsSectionSchema,
  TimelineSectionSchema,
  GallerySectionSchema,
  FaqSectionSchema,
  EmbedSectionSchema,
  CardsSectionSchema,
  SiteSectionSchema,
  SiteSectionListSchema,
} from "./sections.js";
export type { SectionType, SiteSection } from "./sections.js";

// ---- SECTION 4 — theme.ts (three-tier token layering) ----
export {
  CoreTokensSchema,
  SemanticTokensSchema,
  TemplateScopedTokensSchema,
  LayeredThemeSchema,
} from "./theme.js";
export type { CoreTokens, SemanticTokens, LayeredTheme } from "./theme.js";

// ---- SECTION 5 — manifest.ts ----
export {
  CssLayerSchema,
  CSS_LAYER_ORDER,
  emitLayerDeclaration,
  DependencyStrategySchema,
  TemplateDependencySchema,
  TemplateFlowSchema,
  TemplateManifestSchema,
  TemplateOutputSchema,
} from "./manifest.js";
export type {
  CssLayer,
  TemplateDependency,
  TemplateManifest,
  TemplateOutput,
} from "./manifest.js";

// ---- SECTION 6 — content.ts ----
export {
  SiteMetaSchema,
  SiteBrandSchema,
  SiteHeroSchema,
  SiteModulesSchema,
  SiteFooterSchema,
  SiteContentSchema,
} from "./content.js";
export type { SiteContent } from "./content.js";

// ---- SECTION 7 & 8 — definition.ts (stored payload + helpers) ----
export {
  SiteDefinitionSchema,
  slugify,
  assignSlugs,
  validateAgainstManifest,
} from "./definition.js";
export type { SiteDefinition, ValidationIssue } from "./definition.js";
