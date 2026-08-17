// ============================================================================
// src/site-platform/renderer/slotted/index.ts
//
// The slotted render path.
//
// Unlike tokenized templates, this does NOT go through assembleDocument() —
// the imported source IS the document, with its own <head> and <body>. So the
// finalization here rewrites the existing head rather than constructing one:
// the source's SEO tags are stripped and replaced with the site's own, but
// its stylesheets, structure and look are left intact.
// ============================================================================

import { parseHTML } from "linkedom";
import type { SlottedSpec, TemplateManifest, SiteDefinition, ImageAsset, SiteContent } from "@site/schema";
import type { RenderInput, RenderOutput, TemplateContext, AssetManifest }
  from "../types";
import { sanitizeDocument, type StripReport } from "./sanitize";
import { applySlot, applyRepeater, rewriteBundleAssets, resolvePath, type ApplyResult }
  from "./apply";
import { resolveTheme } from "../theme";
import { buildMetaTags } from "../document";
import { scriptHash, sha256Hex, invalidationPaths, planMedia, makeImageUrlResolver }
  from "../assets";
import { cssIdent, cssValue } from "../escape";

import { SlottedDocument, SlottedElement } from './dom';


// ============================================================================
// SOURCE REGISTRY
// ============================================================================

/**
 * Imported source documents, keyed by `sourceKey`.
 *
 * The HTML is imported as a STRING and registered at module load, not read from
 * disk at render time. That is what keeps the render path pure — no filesystem,
 * no network, so the form's live preview runs the identical code.
 *
 * In practice:
 *   import source from "./source.html?raw";        // bundler
 *   registerSource("neon-launch@1", source);
 */
const SOURCES = new Map<string, string>();

export function registerSource(sourceKey: string, html: string): void {
  if (SOURCES.has(sourceKey)) {
    throw new Error(`Source "${sourceKey}" is already registered.`);
  }
  SOURCES.set(sourceKey, html);
}

export function getSource(sourceKey: string): string {
  const html = SOURCES.get(sourceKey);
  if (!html) {
    throw new Error(
      `No source registered for "${sourceKey}". ` +
      `Known: ${[...SOURCES.keys()].join(", ") || "(none)"}`,
    );
  }
  return html;
}

// ============================================================================
// RENDER
// ============================================================================

export interface SlottedRenderResult extends RenderOutput {
  /** Surfaced so the importer can write IMPORT_REPORT.md and CI can diff it. */
  stripReport: StripReport;
}

export async function renderSlotted(input: RenderInput): Promise<SlottedRenderResult> {
  const { definition, manifest, mode = "build", s3Prefix } = input;

  const spec = manifest.slotted;
  if (!spec) {
    throw new Error(`Template "${manifest.id}" is kind:"slotted" but has no slotted spec.`);
  }

  if (mode === "build" && !s3Prefix) {
    throw new Error("s3Prefix is required in build mode");
  }

  // ---- 1. Parse ----
  const source = getSource(spec.sourceKey);

  // Integrity check against the committed hash. A bundle edited in place
  // without a version bump silently changes every site built from it.
  if (spec.sourceHash) {
    const actual = sha256Hex(source);
    if (actual !== spec.sourceHash) {
      throw new Error(
        `Source for "${spec.sourceKey}" does not match the committed hash. ` +
        `Re-import the bundle and bump the template version.`,
      );
    }
  }

  const { document } = parseHTML(source);
  const doc = document as unknown as SlottedDocument;

  // ---- 2. Sanitize ----
  // Before anything else touches the tree: strip scripts, event handlers,
  // unapproved origins, forms and iframes. Third-party markup does not get to
  // run on a customer domain.
  const knownAssets = new Set(spec.bundleAssets.map((a) => a.path));
  const stripReport = sanitizeDocument(doc, { policy: spec.sanitize, knownAssets });

  // ---- 3. Media plan ----
  // Slotted templates still get publish-time crops, driven by each slot's
  // imageSlot and the manifest's imageAspect.
  const plan = mode === "build" ? planMedia(definition, manifest, s3Prefix!) : null;
  const imageUrl = makeImageUrlResolver(mode, plan);

  const theme = resolveTheme({
    theme: definition.theme,
    override: definition.themeOverride,
    manifest,
  });

  const configured = definition.content.footer.legal?.copyrightYear;
  const year = configured && configured !== "auto"
    ? configured
    : new Date().getUTCFullYear();

  const ctx: TemplateContext = {
    definition,
    manifest,
    theme,
    sections: definition.content.sections.filter((s) => s.enabled),
    imageUrl,
    year,
    attributions: [],
  };

  const applied: ApplyResult = { warnings: [], images: [] };

  // ---- 3.5. Disabled sections ----
  // Before repeaters and slots: cloning prototypes into a subtree that's about
  // to vanish is wasted work, and the slot pass would warn on selectors that no
  // longer match — noise indistinguishable from a mapping bug.
  //
  // No mode branch. Preview and build must take the identical path.
  removeDisabledSections(doc as never, spec, definition.content, applied);

  // ---- 4. Repeaters first ----
  // Before slots, so top-level selectors do not accidentally match inside a
  // prototype node that is about to be cloned and removed.
  for (const repeater of spec.repeaters) {
    applyRepeater(
      doc as never,
      repeater,
      definition.content,
      ctx,
      applied,
    );
  }

  // ---- 5. Slots ----
  for (const slot of spec.slots) {
    applySlot(doc as never, slot, definition.content, ctx, applied);
  }

  // ---- 6. Bundle assets ----
  const bundle = mode === "build"
    ? rewriteBundleAssets(
        doc as never,
        spec.bundleAssets,
        `${manifest.id}@${manifest.version}`,
        s3Prefix!,
      )
    : { copies: [], warnings: [] };

  // ---- 7. Anchors ----
  if (spec.rewriteAnchors) rewriteAnchors(doc as never, ctx, applied);

  // In-page links whose target was removed. Warn rather than delete: the link
  // may be a CTA whose label still reads correctly, and silently removing a
  // button is worse than a dead scroll.
  for (const a of Array.from(doc.querySelectorAll('a[href^="#"]'))) {
    const target = (a.getAttribute("href") ?? "").slice(1);
    if (target && !doc.querySelector(`#${cssIdent(target)}`)) {
      applied.warnings.push(`Link to #${target} has no target — its section is disabled or removed.`);
    }
  }

  // ---- 8. Head ----
  replaceMetaTags(doc as never, definition, imageUrl);

  // ---- 8.5. CSS-only backgrounds ----
  // Appended, not prepended: the bundle's own <link>/<style> is never wrapped
  // in @layer for a slotted template (the look is the source's own), so
  // whichever rule comes LAST in source order wins an equal-specificity
  // match. Landing this before the bundle's stylesheet would mean every
  // per-site background silently loses to the bundle's original literal.
  const cssBackgrounds = emitCssBackgrounds(spec, definition.content, imageUrl);
  if (cssBackgrounds) {
    const head = doc.querySelector("head");
    if (head) head.innerHTML += `<style>${cssBackgrounds}</style>`;
  }

  // ---- 9. Approved scripts ----
  // Source scripts were stripped unconditionally in step 2. These are the
  // reviewed replacements, emitted inline and hashed for the CSP.
  const scripts = spec.sanitize.approvedScripts.map((s) => s.source);
  const inlineScriptHashes = scripts.map(scriptHash);

  if (scripts.length > 0) {
    const body = doc.querySelector("body");

    if (body) {
      body.innerHTML += scripts.map((s) => `<script>${s}</script>`).join("\n");
    }
  }

  // ---- 10. Serialize ----
  const html = `<!DOCTYPE html>\n${doc.documentElement.outerHTML}\n`;

  const assetManifest: AssetManifest = {
    copies: bundle.copies,
    media: plan?.entries ?? [],
    invalidationPaths: invalidationPaths(),
    csp: "",              // filled by lib/internal/render.ts once hashes are known
    attributions: [],
    warnings: [
      ...applied.warnings,
      ...bundle.warnings,
      ...(plan?.warnings ?? []),
      ...stripReport.warnings,
    ],
    artifactHash: sha256Hex(html),
  };

  return {
    html,
    body: html,      // no separate fragment; the source is the document
    css: cssBackgrounds, // the source owns its own styling; this is the per-site override on top
    inlineScriptHashes,
    assetManifest,
    stripReport,
  };
}

// ============================================================================
// HEAD REWRITING
// ============================================================================

/**
 * Strip the source's SEO tags and insert the site's own.
 *
 * Without this, every generated site inherits the bundle author's title,
 * description and og:image — which is both wrong and an SEO liability, since
 * dozens of sites would share identical metadata.
 */
function replaceMetaTags(
  doc: {
    querySelectorAll(s: string): Array<{ remove(): void }>;
    querySelector(s: string): { innerHTML: string } | null;
  },
  definition: SiteDefinition,
   imageUrl: (asset: ImageAsset | undefined) => string,
): void {
  const REMOVE = [
    "title",
    'meta[name="description"]',
    'meta[name="keywords"]',
    'meta[name="robots"]',
    'meta[name="theme-color"]',
    'meta[property^="og:"]',
    'meta[name^="twitter:"]',
    'link[rel="canonical"]',
  ];

  for (const selector of REMOVE) {
    for (const el of doc.querySelectorAll(selector)) el.remove();
  }

  const head = doc.querySelector("head");
  if (!head) return;

  // buildMetaTags is shared with the tokenized path, so both produce identical
  // head markup from the same content — one implementation, not two.
  head.innerHTML =
    buildMetaTags(definition, imageUrl(definition.content.meta.cardImage)) +
    "\n" + head.innerHTML;
}

/**
 * Rewrite in-page anchors to match generated section slugs.
 *
 * Imported sources hardcode ids like #about, #features, #contact. When the
 * author renames a section the nav label changes but the source's anchor does
 * not, so links silently stop resolving. Matching by ORDER rather than by name
 * is the only mapping available here, which is why this is opt-in.
 */
function rewriteAnchors(
  doc: { querySelectorAll(s: string): Array<{
    getAttribute(n: string): string | null;
    setAttribute(n: string, v: string): void;
  }> },
  ctx: TemplateContext,
  result: ApplyResult,
): void {
  const anchors = doc.querySelectorAll('a[href^="#"]');
  const slugs = ctx.sections.map((s) => s.slug);

  const seen: string[] = [];

  for (const a of anchors) {
    const href = a.getAttribute("href");
    if (!href || href === "#" || href === "#top") continue;

    const original = href.slice(1);
    let index = seen.indexOf(original);

    if (index === -1) {
      seen.push(original);
      index = seen.length - 1;
    }

    const slug = slugs[index];
    if (slug) {
      a.setAttribute("href", `#${slug}`);
    } else {
      result.warnings.push(
        `Anchor "#${original}" has no corresponding section; left unchanged.`,
      );
    }
  }
}


/**
 * Per-site background rules. Emitted rather than inlined so the CSP needs no
 * unsafe-inline, and keyed by the source's own selectors since removal and
 * slots have already run against them.
 *
 * A Slot targets an element; there is no selector that reaches a
 * pseudo-element's own generated box, so a ::before/::after background can't
 * go through applySlot at all — this is the other half of that gap.
 */
function emitCssBackgrounds(
  spec: SlottedSpec,
  content: SiteContent,
  imageUrl: (asset: ImageAsset | undefined) => string,
): string {
  return spec.cssBackgrounds.flatMap((bg) => {
    const image = resolvePath(content, bg.path) as ImageAsset | undefined;
    if (!image) return [];

    const url = imageUrl(image);
    if (!url) return [];

    const target = bg.pseudo ? `${bg.selector}::${bg.pseudo}` : bg.selector;
    const position =
      `${((image.focalX ?? 0.5) * 100).toFixed(1)}% ${((image.focalY ?? 0.5) * 100).toFixed(1)}%`;

    return [`${target}{background-image:url(${cssValue(url)});background-position:${position}}`];
  }).join("");
}

// ============================================================================
// REGISTRATION
// ============================================================================

/**
 * Register a slotted template.
 *
 *   registerSlottedTemplate("neon-launch@1", sourceHtml);
 *
 * The mapping itself lives in the manifest, so it can be edited and re-synced
 * without touching code — which is the point: re-importing an updated bundle
 * means replacing source.html and adjusting selectors, not rewriting a renderer.
 */
export function registerSlottedTemplate(sourceKey: string, html: string): void {
  registerSource(sourceKey, html);
}

export { formatReport } from "./sanitize";
export type { StripReport } from "./sanitize";



/**
 * Remove the DOM node for every section the site has switched off.
 *
 * Slot paths are POSITIONAL — `sections[1].title` — so a disabled section keeps
 * its array entry and its index. Only the node and its nav link go. Deleting
 * the entry instead would shift every later section's content by one, silently.
 *
 * A section absent from content is also removed: a preset may cover fewer
 * sections than the source markup provides.
 */
function removeDisabledSections(
  doc: SlottedDocument,
  spec: SlottedSpec,
  content: SiteContent,
  applied: ApplyResult,
): void {
  for (const node of spec.sectionNodes) {
    const section = resolvePath(content, node.path) as { enabled?: boolean } | undefined;
    if (section && section.enabled !== false) continue;

    const el = doc.querySelector(node.selector);
    if (!el) {
      applied.warnings.push(
        `sectionNodes: "${node.selector}" (${node.path}) matched nothing — ` +
        `the mapping is stale relative to the source.`,
      );
      continue;
    }

    el.remove();
    // Leaving the nav link behind ships a menu item that scrolls nowhere.
    if (node.navSelector) doc.querySelector(node.navSelector)?.remove();
  }
}