// ============================================================================
// tools/template-import/emit.ts
//
// STEP 8A — produce a tokenized-slotted template package.
//
// The source document is kept intact and its stylesheet is rewritten so every
// mapped literal becomes a var() reference. That's what buys palette control
// without authoring a render function: the layout is the source's, the colours
// are the customer's.
//
// Output: site-platform/renderer/templates/{name}/
//   bundle.generated.ts   SOURCE_HTML + SOURCE_CSS, registered at module load
//   manifest.ts           written ONLY when absent — selector work survives
//   index.ts              written ONLY when absent
//
// Never touches .generated/ — that's the analysis working directory.
// ============================================================================

import { createHash } from "node:crypto";

import { tokenToVar } from "@site/schema";
import { rewriteCss, neutralizeCoveredBackgrounds, neutralizeCoveredScrims, type Substitution, type TokenizeResult } from "./css/tokenize-css.js";
import { TemplateAnalysis } from "./analyze.js";
import type { MergedImport } from "./merge.js";
import type { PreparedBundleAsset } from "./assets.js";
import type { TemplatePreset, TemplateManifest } from "@site/schema";
// Reused rather than reimplemented: this is the exact resolver renderSlotted
// runs cssBackgrounds paths through at render time, so "does this path
// resolve" is asked the identical way here and there.
import { resolvePath } from "../../site-platform/renderer/slotted/apply.js";

// ============================================================================
// TYPES
// ============================================================================

export interface EmitInput {
  templateId: string;
  templateVersion: string;
  html: string;
  css: string;
  tokenize: TokenizeResult;
  /** .generated/spec.draft.json, after review. */
  spec: Record<string, unknown>;
  /** Authored in step 7. Supplies section types and counts. */
  preset: TemplatePreset;
  /** Stylesheets referenced by <link> that were not tokenized. */
  linkedStylesheets?: string[];
/** Needed for sectionNodes: selectors must use the SOURCE document's ids,
*  not the preset's generated slugs. They agree only by coincidence. */
  analysis: TemplateAnalysis;
  /** Supplies cssBackgrounds — merge.ts already joined markup and CSS to find
   *  section backgrounds that live only in a ::before rule. */
  merged: MergedImport;
  /** .generated/assets.json's bundleAssets, from step 6. Empty on a run
   *  before `assets` has executed. */
  bundleAssets: PreparedBundleAsset[];
}

export interface EmitResult {
  /** The stylesheet that ships. */
  css: string;
  cssHash: string;
  /**
   * The same object serialized into manifest.ts, before JSON.stringify. Lets
   * a caller (emitDir's preview render) use exactly what was just computed
   * without re-parsing the file it wrote or importing a module for it.
   */
  manifest: TemplateManifest;
  /** File contents, keyed by path relative to the template directory. */
  files: Record<string, string>;
  /** Paths that must not overwrite an existing file. */
  writeOnlyIfAbsent: string[];
  warnings: string[];
    /**
   * Conditions that must be resolved before this emit can be trusted. Distinct
   * from `warnings`: a misaligned sectionNodes map fails silently at render —
   * every selector still resolves, just to the wrong section.
   */
  blockers: string[];
}

// ============================================================================
// EMIT
// ============================================================================

export function emitTemplate(input: EmitInput): EmitResult {
  const warnings: string[] = [];
  const blockers: string[] = [];

  // --- 1. Rewrite ----------------------------------------------------------
  // Skips substitutions whose token has no variable rather than throwing, so
  // one gap in the mapping table doesn't block the whole emit — but every skip
  // is reported, because a silently unmapped token is a control that does
  // nothing while the page still looks correct.
  const usable: Substitution[] = [];

  for (const sub of input.tokenize.substitutions) {
    try {
      tokenToVar(sub.token);
      usable.push(sub);
    } catch (error) {
      warnings.push(`${sub.selector} { ${sub.property} }: ${(error as Error).message}`);
    }
  }

  // Computed once, before the manifest section builds it a second time
  // below — the neutralization pass needs it too, and the two must agree on
  // exactly the same covered set or SOURCE_CSS and the per-site rules could
  // disagree about which selectors own which background.
  const cssBackgrounds = buildCssBackgrounds(input.merged);
  const cssScrims = buildCssScrims(input.merged);

  // A cssBackgrounds path that doesn't resolve renders no background at all —
  // silently, since renderSlotted's emitCssBackgrounds just treats a missing
  // image as "nothing to show" (see its own `if (!image) return []`). That's
  // correct behaviour for content genuinely left blank; it's a blocker when
  // the path itself is wrong, because nothing distinguishes the two cases
  // downstream. Caught the hard way on spacex-ipo: a pathFor() indexing bug
  // sent three of four backgrounds to a neighboring section's image and the
  // fourth off the end of the array, and every one of them rendered "as
  // designed" until someone diffed the actual page against the source.
  for (const bg of cssBackgrounds) {
    if (resolvePath(input.preset.content, bg.path) === undefined) {
      blockers.push(
        `cssBackgrounds: "${bg.path}" (for selector "${bg.selector}") resolves to ` +
        `undefined against the preset content — that background will render as ` +
        `nothing, or worse, may indicate every other cssBackgrounds path is also ` +
        `miscounted. Check pathFor()'s section indexing against preset.content.sections.`,
      );
    }
  }

  // Same invariant as cssBackgrounds, same pathFor() dependency, same failure
  // mode if it drifts: a wrong index still resolves to SOME number, so a
  // scrim silently renders at the wrong section's opacity rather than failing.
  for (const scrim of cssScrims) {
    const opacity = resolvePath(input.preset.content, scrim.path);
    if (typeof opacity !== "number") {
      blockers.push(
        `cssScrims: "${scrim.path}" (for selector "${scrim.selector}") resolves to ` +
        `${JSON.stringify(opacity)}, not a number — that scrim will render fully ` +
        `opaque or not at all. Check pathFor()'s section indexing against ` +
        `preset.content.sections.`,
      );
    }
  }

  // Keyed identically to what the classify pass put in AssetRef.selector —
  // selectorsOf() produces the full selector INCLUDING any pseudo
  // (".starship::before"), but cssBackgrounds stores selector/pseudo split
  // (see buildCssBackgrounds below), so recovering that key is a join, not
  // a lookup. Built from cssBackgrounds specifically, not from every asset
  // tokenize-css classified minus orphans — orphans are path-preserved into
  // bundleAssets and must keep resolving, and cssBackgrounds already
  // excludes them by construction (attachBackgrounds only pushes here on a
  // section match).
  const covered = new Set(
    cssBackgrounds.map((bg) => (bg.pseudo ? `${bg.selector}::${bg.pseudo}` : bg.selector)),
  );

  // NOT built from cssScrims's own selector/pseudo — those are the per-section
  // id-based targets the per-site rule paints on (#launch::after, #ipo::after…),
  // deliberately different from what SOURCE_CSS actually wrote (routinely a
  // single shared rule, ".hero::after, .section::after"). Neutralizing has to
  // match the LATTER or it silently no-ops — the exact selector-namespace trap
  // neutralizeCoveredBackgrounds's own doc comment already warns about, hit
  // for real here: covered from cssScrims's selectors matched nothing on the
  // first pass through this fix, and the css hash didn't move.
  const coveredScrims = new Set(input.merged.cssScrims.map((s) => s.sourceSelector));

  const rewritten = neutralizeCoveredScrims(
    neutralizeCoveredBackgrounds(
      rewriteCss(input.css, usable, tokenToVar),
      covered,
    ),
    coveredScrims,
  );
  const cssHash = sha256(rewritten);

  // --- 2. Theme surface ----------------------------------------------------
  // Derived from what the rewrite actually consumed, not hand-listed. This is
  // the whole reason usesThemeKeys can be trusted to drive form disclosure:
  // a key appears here exactly when a var() referencing it exists in the CSS.
  const consumed = [...new Set(usable.map((s) => s.token))].sort();

  const usesThemeKeys = consumed.filter((t) => !t.startsWith("templates."));
  const customThemeSchema = buildCustomThemeSchema(usable);

  if (usesThemeKeys.length === 0) {
    warnings.push(
      "No theme keys were consumed — the emitted template has no palette control. " +
      "Check that source.css was actually passed to tokenizeCss.",
    );
  }

  // --- 3. Manifest ---------------------------------------------------------
  const sectionTypes = [...new Set(input.preset.content.sections.map((s) => s.type))];
  const sectionCount = input.preset.content.sections.length;

  const manifest = {
    id: input.templateId,
    name: titleCase(input.templateId),
    description: `Imported from ${input.templateId}.`,
    version: input.templateVersion,
    previewImage: `_templates/${input.templateId}@${input.templateVersion}/preview.png`,

    rendererKey: "slotted",
    flow: "vertical",

    supportedSectionTypes: sectionTypes,
    // A slotted template renders exactly the regions its slots cover. Bounds
    // wider than the source's own structure mean the form offers sections the
    // build silently drops.
    sectionCount: { min: sectionCount, max: sectionCount },

    supportsModules: [],
    requiredContent: ["hero.title", "meta.title"],
    dependencies: [],

    imageAspect: { hero: "16/9", section: "16/9", card: "4/3", gallery: "1/1" },

    usesThemeKeys,
    ...(Object.keys(customThemeSchema).length > 0 ? { customThemeSchema } : {}),

    capabilities: {
      hasStickyNav: /position:\s*fixed/.test(input.css),
      hasMobileDrawer: /menu-toggle|hamburger|nav-links\.active/.test(input.html),
      supportsPerSectionBackground: true,
    },

    kind: "slotted",
    slotted: {
      ...input.spec,
      // Overrides the draft's placeholder ("{name}@1", written at analyze
      // time before a version exists). registerSlottedTemplate always
      // registers under "{id}@{version}" (see emitBundle below) — leaving the
      // draft's key in place means this manifest's sourceKey never matches
      // what's actually registered, and getSource() throws on every render.
      // Caught the hard way: spacex-ipo shipped with sourceKey "spacex-ipo@1"
      // against a registration of "spacex-ipo@1.0.0".
      sourceKey: `${input.templateId}@${input.templateVersion}`,
      sectionNodes: buildSectionNodes(input.analysis, input.preset, warnings, blockers),
      cssBackgrounds,
      cssScrims,
      bundleAssets: input.bundleAssets,
      sourceHash: sha256(input.html),

      // Presence of this is what lifts the "usesThemeKeys must be empty"
      // refinement — the look is fixed exactly when the CSS wasn't tokenized.
      cssTokenized: { source: "inline", cssHash },
    },
  };

  if (input.linkedStylesheets?.length) {
    warnings.push(
      `${input.linkedStylesheets.length} linked stylesheet(s) were not tokenized ` +
      `(${input.linkedStylesheets.join(", ")}). Add them to bundleAssets, or their ` +
      `rules stay fixed and their url() references break at publish.`,
    );
  }

  return {
    css: rewritten,
    cssHash,
    // Same loose-then-cast trust the generated file itself relies on
    // (emitManifest writes it with `as TemplateManifest`) — this isn't a
    // stricter guarantee, just the identical object instead of a re-parse.
    manifest: manifest as unknown as TemplateManifest,
    files: {
      "bundle.generated.ts": emitBundle(input.templateId, input.templateVersion, input.html, rewritten),
      "manifest.ts": emitManifest(manifest),
      "index.ts": emitIndex(input.templateId),
    },
    // manifest.ts holds reviewed selector work; index.ts is hand-wired.
    // Regenerating either would discard the review.
    writeOnlyIfAbsent: ["manifest.ts", "index.ts"],
    warnings,
    blockers,
  };
}

// ============================================================================
// TIER 3
// ============================================================================

/**
 * Template-scoped controls, from the Tier 3 tokens the rewrite consumed.
 *
 * The default is the source's own literal, so a template that exposes a header
 * blur starts at the blur the source had.
 */
function buildCustomThemeSchema(substitutions: Substitution[]) {
  const out: Record<string, unknown> = {};

  for (const sub of substitutions) {
    const key = sub.token.match(/^templates\.[^.]+\.(.+)$/)?.[1];
    if (!key || out[key]) continue;

    out[key] = {
      type: controlType(sub.property, sub.original),
      label: titleCase(key),
      default: sub.original,
    };
  }

  return out;
}

function controlType(property: string, value: string): string {
  if (/color|background/.test(property) && /^(#|rgb|hsl)/.test(value)) return "color";
  if (/^-?[\d.]+(px|rem|em|%|vh|vw)$/.test(value)) return "length";
  if (/^-?[\d.]+$/.test(value)) return "number";
  return "select";
}



// ============================================================================
// FILE BODIES
// ============================================================================

/**
 * Source HTML and CSS as a generated module.
 *
 * Not `?raw` — bundler-specific and unreliable under Turbopack. Not a
 * filesystem read — that breaks renderer purity and the shared-preview
 * guarantee. A registered module string is the only option that survives both.
 */
function emitBundle(id: string, version: string, html: string, css: string): string {
  return [
    "// GENERATED — do not edit. Re-run `import-template emit`.",
    "//",
    "// Registered at module load so the render path stays pure: no filesystem,",
    "// no network, identical in preview and build.",
    "//",
    "// Relative, not \"@site/renderer/slotted\": that subpath has no entry in",
    "// tsconfig's paths, vitest's aliases, or any package.json exports map —",
    "// only the bare \"@site/renderer\" specifier resolves anywhere in this repo.",
    "// The prior generated form was an import no bundler could resolve.",
    "",
    'import { registerSlottedTemplate } from "../../slotted/index";',
    "",
    `export const SOURCE_HTML = \`${escapeTemplate(html)}\`;`,
    "",
    `export const SOURCE_CSS = \`${escapeTemplate(css)}\`;`,
    "",
    `registerSlottedTemplate("${id}@${version}", SOURCE_HTML, SOURCE_CSS);`,
    "",
  ].join("\n");
}

function emitManifest(manifest: Record<string, unknown>): string {
  return [
    "// Generated by `import-template emit`, then HAND-EDITED.",
    "//",
    "// Re-running emit will not overwrite this file. Selector mappings, section",
    "// bounds and module support all live here and are review work.",
    "",
    'import type { TemplateManifest } from "@site/schema";',
    "",
    `export const manifest: TemplateManifest = ${JSON.stringify(manifest, null, 2)} as TemplateManifest;`,
    "",
  ].join("\n");
}

function emitIndex(id: string): string {
  return [
    "// Generated once. Hand-edit freely.",
    "",
    'import "./bundle.generated";',
    'export { manifest } from "./manifest";',
    `export { preset } from "./presets/original";`,
    "",
  ].join("\n");
}

// ============================================================================
// VERIFY
// ============================================================================

/**
 * CI guard. Recomputes both hashes and reports drift.
 *
 * Without this, an edited source.html or a hand-tweaked stylesheet throws at
 * claim time — during a customer's build — instead of at review time.
 */
export function verifyEmit(
  input: Pick<EmitInput, "html" | "css" | "tokenize">,
  manifest: { slotted?: { sourceHash?: string; cssTokenized?: { cssHash?: string } } },
): string[] {
  const issues: string[] = [];

  const sourceHash = sha256(input.html);
  if (manifest.slotted?.sourceHash && manifest.slotted.sourceHash !== sourceHash) {
    issues.push("source.html has changed since emit — re-run `import-template emit`.");
  }

  const usable = input.tokenize.substitutions.filter((s) => {
    try { tokenToVar(s.token); return true; } catch { return false; }
  });

  const cssHash = sha256(rewriteCss(input.css, usable, tokenToVar));
  if (manifest.slotted?.cssTokenized?.cssHash !== cssHash) {
    issues.push("Rewritten CSS does not match the recorded hash — source.css or overrides.json changed.");
  }

  return issues;
}

// ============================================================================
// HELPERS
// ============================================================================

const sha256 = (value: string): string =>
  createHash("sha256").update(value, "utf8").digest("hex");

/**
 * Backticks, backslashes and `${` — the last is the dangerous one: unescaped,
 * whatever follows it in the source is evaluated as a template expression.
 */
const escapeTemplate = (value: string): string =>
  value.replace(/\\/g, "\\\\").replace(/`/g, "\\`").replace(/\$\{/g, "\\${");

const titleCase = (value: string): string =>
  value
    .replace(/[-_]/g, " ")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/\b\w/g, (c) => c.toUpperCase());


// ============================================================================
// CSS BACKGROUNDS
// ============================================================================

/**
 * Split merge.ts's `cssBackgrounds` (sectionPath/selector/sourceUrl, selector
 * still carrying the pseudo) into the manifest shape (path/selector/pseudo,
 * split apart) — SlottedSpecSchema.cssBackgrounds needs the pseudo isolated
 * so the render path can build `${selector}::${pseudo}` itself rather than
 * string-matching it back out of a combined selector every render.
 *
 * `sourceUrl` is dropped: it named the bundle's OWN image, used at import time
 * to know what to download. At render time the real asset lives at
 * `content[path]`, already through the asset pipeline.
 */
function buildCssBackgrounds(
  merged: MergedImport,
): Array<{ path: string; selector: string; pseudo?: "before" | "after" }> {
  return merged.cssBackgrounds.map((bg) => {
    const match = bg.selector.match(/^(.*?)::?(before|after)$/);

    return {
      path: `${bg.sectionPath}.backgroundImage`,
      selector: match ? match[1]! : bg.selector,
      pseudo: match ? (match[2] as "before" | "after") : undefined,
    };
  });
}

/**
 * Same split as buildCssBackgrounds, for merge.ts's `cssScrims` — the section
 * whose overlayOpacity this scrim rule needs, and the selector (pseudo
 * included) to paint it on.
 */
function buildCssScrims(
  merged: MergedImport,
): Array<{ path: string; selector: string; pseudo?: "before" | "after" }> {
  return merged.cssScrims.map((s) => {
    const match = s.selector.match(/^(.*?)::?(before|after)$/);

    return {
      path: `${s.sectionPath}.overlayOpacity`,
      selector: match ? match[1]! : s.selector,
      pseudo: match ? (match[2] as "before" | "after") : undefined,
    };
  });
}

// ============================================================================
// SECTION NODES
// ============================================================================

/**
 * The sectionNodes alignment check, without doing an emit.
 *
 * Separated so `check` can run it without loading a preset module or
 * rewriting a stylesheet. The condition is worth gating CI on because it
 * fails SILENTLY at render: a misaligned map still resolves every selector,
 * just to the wrong section, so a site disables one section and loses a
 * different one.
 */
export function validateEmitInputs(
  analysis: TemplateAnalysis,
  sectionCount: number,
): string[] {
  const nonHero = analysis.sections.filter((s) => !s.isHero).length;

  return nonHero === sectionCount
    ? []
    : [
        `sectionNodes misaligned: analysis has ${nonHero} non-hero section(s), ` +
        `preset has ${sectionCount}. Re-run analyze and preset from the same source.`,
      ];
}

/**
 * Map each content section to the DOM node it renders into, so a section
 * switched off in the wizard can have its node removed.
 *
 * Two identifier spaces meet here and they are NOT interchangeable:
 *
 *   path       indexes the PRESET's sections array, hero excluded — hero is
 *              not a member of SiteContent.sections.
 *   selector   targets the SOURCE document's own id. removeDisabledSections
 *              runs at step 3.5, before rewriteAnchors, so at that point the
 *              DOM still carries the ids the bundle shipped with.
 *
 * On the reference template these coincide: nav labels "IPO"/"Offering"/"Coin"
 * slugify to the same ids the source used. A source with id="section-2" and a
 * nav label of "Roadmap" gives #roadmap from the preset and #section-2 in the
 * DOM, and every selector misses silently.
 */
function buildSectionNodes(
  analysis: TemplateAnalysis,
  preset: TemplatePreset,
  warnings: string[],
  blockers: string[],
): Array<{ path: string; selector: string; navSelector?: string }> {
  const nonHero = analysis.sections.filter((s) => !s.isHero);

  // analyze and preset are separate commands, so overrides.json can change
  // between them. Misalignment here disables the wrong section — silently,
  // since every selector still resolves to something. validateEmitInputs is
  // also what `check` runs on its own, without loading a preset module or
  // doing a full emit — one implementation of the comparison, not two.
  const emitBlockers = validateEmitInputs(analysis, preset.content.sections.length);
  blockers.push(...emitBlockers);

  if (emitBlockers.length > 0) {
    warnings.push(
      `Analysis found ${nonHero.length} non-hero section(s) but the preset has ` +
      `${preset.content.sections.length}. sectionNodes will be misaligned — ` +
      `re-run analyze and preset from the same source before emitting.`,
    );
  }

  return nonHero.map((section, i) => {
    if (!section.sourceId) {
      warnings.push(
        `Section ${i} ("${section.navLabel ?? "?"}") has no id in the source, so it ` +
        `cannot be disabled. Give it an id in source.html and re-run init.`,
      );
    }

    return {
      path: `sections[${i}]`,
      // Already "#id" when an id exists; cssPath() fallback otherwise.
      selector: section.selector,
      // $= rather than =: sources ship href=" #ipo" and href="page.html#ipo".
      // normalize.ts trims the whitespace case, but the suffix match costs
      // nothing and is correct on a one-pager either way.
      navSelector: section.sourceId ? `a[href$="#${section.sourceId}"]` : undefined,
    };
  });
}