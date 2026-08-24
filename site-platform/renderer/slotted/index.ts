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
import { applySlot, applyRepeater, rewriteBundleAssets, rewriteCssAssetUrls, resolvePath, type ApplyResult }
  from "./apply";
import { resolveTheme } from "../theme";
import type { ResolvedTheme } from "../types";
import { buildMetaTags } from "../document";
import { scriptHash, sha256Hex, invalidationPaths, planMedia, makeImageUrlResolver }
  from "../assets";
import { cssIdent, cssValue } from "../escape";
import { tokenToVar } from "@site/schema";

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
interface RegisteredSource {
  html: string;
  /**
   * Rewritten stylesheet, for cssTokenized templates only.
   *
   * Separate from `html` because normalizeSource extracts <style> out at init.
   * For a tokenized template this IS the page's styling, not an addition to it
   * — an untokenized bundle keeps its own <style>/<link> inside `html` and
   * registers no css here.
   */
  css?: string;
}

const SOURCES = new Map<string, RegisteredSource>();

export function registerSource(sourceKey: string, html: string, css?: string): void {
  if (SOURCES.has(sourceKey)) {
    throw new Error(`Source "${sourceKey}" is already registered.`);
  }
  SOURCES.set(sourceKey, { html, css });
}

export function getSource(sourceKey: string): RegisteredSource {
  const source = SOURCES.get(sourceKey);
  if (!source) {
    throw new Error(
      `No source registered for "${sourceKey}". ` +
      `Known: ${[...SOURCES.keys()].join(", ") || "(none)"}`,
    );
  }
  return source;
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

  if (spec.sourceHash) {
    const actual = sha256Hex(source.html);
    if (actual !== spec.sourceHash) {
      throw new Error(
        `Source for "${spec.sourceKey}" does not match the committed hash. ` +
        `Re-import the bundle and bump the template version.`,
      );
    }
  }

  // A tokenized template whose stylesheet never arrived renders unstyled while
  // every var() falls back to its source literal — the page looks plausible and
  // no theme control does anything. Loud, not silent.
  if (spec.cssTokenized) {
    if (!source.css) {
      throw new Error(
        `Template "${spec.sourceKey}" declares cssTokenized but no stylesheet was ` +
        `registered. Re-run \`import-template emit\` and check that ` +
        `registerSlottedTemplate is called with three arguments.`,
      );
    }

    if (sha256Hex(source.css) !== spec.cssTokenized.cssHash) {
      throw new Error(
        `Stylesheet for "${spec.sourceKey}" does not match the committed hash. ` +
        `Re-run emit and bump the template version.`,
      );
    }
  }

  const { document } = parseHTML(source.html);
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

  // ---- 8.5. Styles ----
  //
  // Order matters for the LAST entry only. Custom properties resolve at
  // computed-value time regardless of declaration order, so tokens-first is
  // readability — but the per-site background rules must follow SOURCE_CSS,
  // which still carries the source's own background-image url()s at equal
  // specificity. Source order decides that one.
  const cssBackgrounds = emitCssBackgrounds(spec, definition.content, imageUrl);
  const cssScrims = emitCssScrims(spec, definition.content);

  // Bundle-asset url()s in source.css (an orphaned background-image, or any
  // other file promoted to bundleAssets) only have a published path in build
  // mode — mirrors step 6's DOM attribute rewrite, gated the same way, since
  // the mapping doesn't exist until then. Left as the source's own relative
  // reference in preview, exactly like every other bundle asset.
  const sourceCss = mode === "build"
    ? rewriteCssAssetUrls(source.css ?? "", spec.bundleAssets)
    : (source.css ?? "");

  const styles = [
    emitTokenBlock(theme),
    sourceCss,
    cssBackgrounds,
    cssScrims,
  ].filter(Boolean).join("\n");

  if (styles) {
    const head = doc.querySelector("head");
    if (head) {
      // createElement + appendChild, not innerHTML +=: the latter reparses the
      // whole head and can normalize attribute quoting, shifting artifactHash
      // for reasons unrelated to content.
      const style = doc.createElement("style");
      style.textContent = styles;
      head.appendChild(style);
    }
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
    css: cssBackgrounds + cssScrims, // the source owns its own styling; this is the per-site override on top
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
export interface CssBackgroundResolution {
  /** Selector + pseudo, e.g. ".starship::before" — matches a verify Difference's `${selector}::${pseudo}`. */
  target: string;
  url: string;
  position: string;
}

/**
 * Resolve every cssBackgrounds entry to the concrete URL it will render.
 *
 * Exported so verify (tools/template-import/verify.ts) can compute the SAME
 * expected value independently — from preset.content, through the identical
 * resolver — rather than trusting that "some /media/ URL showed up" means
 * the RIGHT one did. A wrong sectionPath (the pathFor() bug) still produces
 * a real, well-formed URL; only comparing against an independent
 * recomputation catches that it's the wrong section's.
 */
export function computeCssBackgroundUrls(
  spec: SlottedSpec,
  content: SiteContent,
  imageUrl: (asset: ImageAsset | undefined) => string,
): CssBackgroundResolution[] {
  return spec.cssBackgrounds.flatMap((bg) => {
    const image = resolvePath(content, bg.path) as ImageAsset | undefined;
    if (!image) return [];

    const url = imageUrl(image);
    if (!url) return [];

    const target = bg.pseudo ? `${bg.selector}::${bg.pseudo}` : bg.selector;
    const position =
      `${((image.focalX ?? 0.5) * 100).toFixed(1)}% ${((image.focalY ?? 0.5) * 100).toFixed(1)}%`;

    return [{ target, url, position }];
  });
}

function emitCssBackgrounds(
  spec: SlottedSpec,
  content: SiteContent,
  imageUrl: (asset: ImageAsset | undefined) => string,
): string {
  return computeCssBackgroundUrls(spec, content, imageUrl)
    .map(({ target, url, position }) =>
      `${target}{background-image:url(${cssValue(url)});background-position:${position}}`,
    )
    .join("");
}

/**
 * Per-section scrim alpha, resolved the same independent way
 * computeCssBackgroundUrls is — from content, through cssScrims, with nothing
 * assumed about what the theme block already emitted.
 *
 * core.colors.overlay (theme, global, alpha-less) and overlayOpacity
 * (content, per-section) have no property that can hold both at once; this
 * is the per-site rule that recombines them, the same job a tokenized
 * template's section renderer does with a --section-overlay custom property.
 * Slotted has no section renderer, so it's done once here instead of per-render.
 */
export interface CssScrimResolution {
  /** Selector + pseudo, e.g. ".hero::after" — matches a verify Difference's `${selector}::${pseudo}`. */
  target: string;
  opacity: number;
}

export function computeCssScrimRules(
  spec: SlottedSpec,
  content: SiteContent,
): CssScrimResolution[] {
  return spec.cssScrims.flatMap((scrim) => {
    const opacity = resolvePath(content, scrim.path);
    if (typeof opacity !== "number") return [];

    const target = scrim.pseudo ? `${scrim.selector}::${scrim.pseudo}` : scrim.selector;
    return [{ target, opacity }];
  });
}

function emitCssScrims(spec: SlottedSpec, content: SiteContent): string {
  const overlayVar = tokenToVar("core.colors.overlay");

  return computeCssScrimRules(spec, content)
    .map(({ target, opacity }) =>
      `${target}{background-color:color-mix(in srgb, var(${overlayVar}) ${(opacity * 100).toFixed(1)}%, transparent)}`,
    )
    .join("");
}

/**
 * Serialize the resolved theme as custom properties.
 *
 * Both maps in one block: `vars` is the shared surface, `custom` is Tier 3 for
 * this template only. Names can't collide — Tier 3 is `--st-tpl-` prefixed —
 * so a single :root is correct and keeps the output readable.
 */
function emitTokenBlock(theme: ResolvedTheme): string {
  const declarations = [
    ...Object.entries(theme.vars),
    ...Object.entries(theme.custom),
  ].map(([name, value]) => `${name}:${cssValue(String(value))}`);

  return declarations.length > 0 ? `:root{${declarations.join(";")}}` : "";
}

// ============================================================================
// REGISTRATION
// ============================================================================

/**
 * Register a slotted template.
 *
 *   registerSlottedTemplate("neon-launch@1", sourceHtml);              // untokenized
 *   registerSlottedTemplate("neon-launch@1", sourceHtml, rewrittenCss); // tokenized
 *
 * `css` is required for a cssTokenized template and absent otherwise. It was
 * previously missing entirely while emitBundle passed it as a third argument —
 * JS drops extra arguments silently, so every tokenized template rendered with
 * no stylesheet at all and nothing reported it.
 */
export function registerSlottedTemplate(
  sourceKey: string,
  html: string,
  css?: string,
): void {
  registerSource(sourceKey, html, css);
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