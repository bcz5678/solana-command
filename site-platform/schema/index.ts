// ============================================================================
// site-platform/schema/index.ts
//
// Public surface of the schema package.
// ============================================================================

// ---- SECTION 1 — field-meta.ts ----
export { SCHEMA_VERSION } from "./field-meta";
export { fieldRegistry, field, getFieldMeta } from "./field-meta";
export type { FieldWidget, FieldMeta } from "./field-meta";

// ---- SECTION 2 — primitives.ts ----
export {
  responsive,
  CrossAlignSchema,
  TextTransformSchema,
  ImageAssetSchema,
  SiteCtaSchema,
  SocialLinkSchema,
} from "./primitives";
export type { CrossAlign, ImageAsset, SiteCta, SocialLink } from "./primitives";

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
} from "./sections";
export type { SectionType, SiteSection } from "./sections";

// ---- SECTION 4 — theme.ts (three-tier token layering) ----
export {
  CoreTokensSchema,
  SemanticTokensSchema,
  TemplateScopedTokensSchema,
  LayeredThemeSchema,
} from "./theme";
export type { CoreTokens, SemanticTokens, LayeredTheme } from "./theme";

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
} from "./manifest";
export type {
  CssLayer,
  TemplateDependency,
  TemplateManifest,
  TemplateOutput,
} from "./manifest";

// ---- SECTION 6 — content.ts ----
export {
  SiteMetaSchema,
  SiteBrandSchema,
  SiteHeroSchema,
  SiteModulesSchema,
  SiteFooterSchema,
  SiteContentSchema,
} from "./content";
export type { SiteContent } from "./content";

// ---- SECTION 7 & 8 — definition.ts (stored payload + helpers) ----
export {
  SiteDefinitionSchema,
  slugify,
  assignSlugs,
  validateAgainstManifest,
  DraftGuard
} from "./definition";
export type { SiteDefinition, ValidationIssue } from "./definition";

// ---- SECTION 9 — slotted.ts (slotted-template schema) ----
export {
  TemplateKindSchema,
  SlotModeSchema,
  SlotSchema,
  RepeaterSchema,
  BundleAssetSchema,
  SanitizePolicySchema,
  SlottedSpecSchema,
} from "./slotted";
export type {
  TemplateKind,
  SlotMode,
  Slot,
  Repeater,
  BundleAsset,
  SanitizePolicy,
  SlottedSpec,
} from "./slotted";

// ---- SECTION 10 — preset.ts (template starting points) ----
export {
  PresetContentSchema,
  TemplatePresetSchema,
  materializePreset,
  validateAgainstPreset,
} from "./preset";
export type { PresetContent, TemplatePreset } from "./preset";
