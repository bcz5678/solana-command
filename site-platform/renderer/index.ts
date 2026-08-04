// ============================================================================
// packages/site-renderer/src/index.ts
//
// Public surface of the renderer package.
//
// Server-only: uses node:crypto for content and script hashing, so this cannot
// be imported into a client component. The form's live preview goes through
// POST /api/sites/:id/preview rather than rendering in the browser.
// ============================================================================

// ---- Core render path ----
export { renderTemplate, 
  registerTemplate, 
  TEMPLATES 
} from "./render";

export { assembleDocument } from "./document";

// ---- Theme ----
export { 
  resolveTheme, 
  flattenTheme, 
  deepMerge, 
  contrastRatio 
} from "./theme";

// ---- Assets ----
export {
  planMedia,
  planVendorCopies,
  makeImageUrlResolver,
  collectImages,
  invalidationPaths,
  hashedName,
  sha256Hex,
  scriptHash,
  IMMUTABLE,
  DOCUMENT_CACHE,
} from "./assets";

// ---- Vendor resolution ----
// Moved here from the standalone vendor-registry.ts written earlier; it is
// part of the renderer, not a loose file.
export {
  resolveDependency,
  buildCsp,
  emitLayerDeclaration,
  CSS_LAYER_ORDER,
} from "./vendor";

export type {
  VendorPackage,
  VendorPackageVersion,
  ResolvedDependency,
  ResolveContext,
} from "./vendor";

// ---- Escaping ----
// Templates must route all interpolation through these.
export { 
  esc, 
  escAttr, 
  safeUrl, 
  cssValue, 
  cssIdent, 
  attrs, 
  cx, 
} from "./escape";

// ---- Types ----
export type {
  ResolvedTheme,
  TemplateOutput,
  TemplateContext,
  TemplateRenderer,
  RenderInput,
  RenderOutput,
  RenderMode,
  AssetManifest,
  AssetCopy,
  AssetMediaEntry,
} from "./types";

// ---- Template registration ----
// Importing for side effects: each template calls registerTemplate() at module
// load. Must come last so the registry exists before templates populate it.
import "./templates/index";