// ============================================================================
// packages/site-renderer/src/render.ts
//
// The dispatcher. Resolves the theme, normalises sections, plans assets, calls
// the template's render function, and hands the fragments to assembleDocument.
//
// Pure: no network, no filesystem, no AWS SDK. That is what lets the form's
// live preview call exactly this code path and be structurally incapable of
// drifting from production output.
// ============================================================================

import { assignSlugs } from "@site/schema";
import type { SiteSection } from "@site/schema";
import type {
  RenderInput,
  RenderOutput,
  TemplateContext,
  TemplateRenderer,
  AssetManifest,
} from "./types";
import { resolveTheme } from "./theme";
import { assembleDocument } from "./document";
import {
  planMedia,
  planVendorCopies,
  makeImageUrlResolver,
  invalidationPaths,
  sha256Hex,
  type MediaPlan,
} from "./assets";
import { renderSlotted } from "./slotted/index"

// ============================================================================
// REGISTRY
// ============================================================================

/**
 * Every renderable template, keyed by the `rendererKey` stored in
 * private.template_versions.
 *
 * Adding a template is one entry here plus one manifest row. Nothing in the
 * form, the routes, the SQL, or n8n changes.
 */
export const TEMPLATES: Record<string, TemplateRenderer> = {
  // Registered in ./templates/index.ts to avoid a circular import.
};

export function registerTemplate(key: string, renderer: TemplateRenderer): void {
  if (TEMPLATES[key]) {
    throw new Error(`Template "${key}" is already registered.`);
  }
  TEMPLATES[key] = renderer;
}

// ============================================================================
// SECTION NORMALISATION
// ============================================================================

/**
 * Enabled sections, ordered by `order`, with unique slugs assigned.
 *
 * Done once here rather than in each template, so no two templates can
 * disagree about ordering semantics — and so slug generation cannot be
 * bypassed, which is what produced dead nav anchors in the original template.
 */
function normaliseSections(sections: SiteSection[]): SiteSection[] {
  const enabled = sections.filter((s) => s.enabled);

  // assignSlugs sorts by `order` and dedupes collisions deterministically
  // (about, about-2), falling back to the section id for labels that slugify
  // to nothing — an emoji-only nav label, for instance.
  return assignSlugs(enabled) as SiteSection[];
}

// ============================================================================
// RENDER
// ============================================================================

export async function renderTemplate(input: RenderInput): Promise<RenderOutput> {
  const {
    definition,
    manifest,
    vendor,
    rendererKey,
    mode = "build",
    s3Prefix,
  } = input;

   // ---- 0. Slotted templates take a different path entirely ----
  //
  // An imported source IS the document: it has its own <head>, its own
  // stylesheets, its own structure. So there is no assembleDocument() call, no
  // registered render function, and no template CSS to wrap in @layer.
  //
  // Everything downstream still applies — media planning, content hashing,
  // asset manifests, CSP hashes — which is why renderSlotted returns the same
  // RenderOutput shape and callers need no branch of their own.
  if (manifest.kind === "slotted") {
    return renderSlotted(input);
  }

  // ---- 1. Locate the renderer ----
  const renderer = TEMPLATES[rendererKey];
  if (!renderer) {
    throw new Error(
      `No renderer registered for "${rendererKey}". ` +
      `Known: ${Object.keys(TEMPLATES).join(", ") || "(none)"}`,
    );
  }

  if (mode === "build" && !s3Prefix) {
    // Failing loudly beats silently emitting staging URLs into a published page.
    throw new Error("s3Prefix is required in build mode");
  }

  // ---- 2. Theme ----
  // Inheritance, per-site override, semantic derivation and type-scale
  // generation all collapse here into concrete CSS variables.
  const theme = resolveTheme({
    theme: definition.theme,
    override: definition.themeOverride,
    manifest,
  });

  // ---- 3. Sections ----
  const sections = normaliseSections(definition.content.sections);

  // ---- 4. Media plan ----
  // Build mode only. Preview keeps the signed staging URLs, so the author sees
  // their images without waiting on a crop pass that would be thrown away.
  const plan: MediaPlan | null =
    mode === "build" ? planMedia(definition, manifest, s3Prefix!) : null;

  const imageUrl = makeImageUrlResolver(mode, plan);

  // ---- 5. Copyright year ----
  // The original template hardcoded ©2026. "auto" resolves at build time.
  const configured = definition.content.footer.legal?.copyrightYear;
  const year =
    configured && configured !== "auto"
      ? configured
      : new Date().getUTCFullYear();

  // ---- 6. Attributions ----
  const attributions = vendor
    .map((v) => v.attribution)
    .filter((a): a is string => Boolean(a));

  // ---- 7. Call the template ----
  const ctx: TemplateContext = {
    definition,
    manifest,
    theme,
    sections,
    imageUrl,
    year,
    attributions,
  };

  const output = await renderer(ctx);

  // ---- 8. Assemble ----
  const ogImageUrl = imageUrl(definition.content.meta.cardImage);

  const { html, inlineScriptHashes } = assembleDocument({
    definition,
    theme,
    output,
    vendor,
    ogImageUrl,
  });

  // ---- 9. Asset manifest ----
  const assetManifest: AssetManifest = {
    copies: planVendorCopies(vendor),
    media: plan?.entries ?? [],
    invalidationPaths: invalidationPaths(),
    // Filled in by lib/internal/render.ts once script hashes are known —
    // buildCsp needs them and they only exist after assembly.
    csp: "",
    attributions,
    warnings: plan?.warnings ?? [],
    artifactHash: sha256Hex(html),
  };

  return {
    html,
    body: output.body,
    css: output.css,
    inlineScriptHashes,
    assetManifest,
  };
}