// ============================================================================
// tools/template-import/merge.ts
//
// Join the markup pass and the CSS pass.
//
// Three facts exist only when both results are in hand:
//
//   headingUsage   a heading tag used once is a label, not part of the type
//                  scale — but only the markup knows that, and only the CSS
//                  pass can use it. Counted here, fed to tokenizeCss BEFORE
//                  this merge runs. The passes are therefore ordered, not
//                  parallel: markup -> css -> merge.
//
//   scrim split    `rgba(0,0,0,.35)` is one literal carrying two values: a
//                  colour that belongs to the theme, and an alpha that belongs
//                  to every section it covers. Neither pass can split it alone.
//
//   backgrounds    the markup knows a section has a background; the CSS knows
//                  what it is. Joined on the selector, minus its pseudo.
//
// Build-time only.
// ============================================================================

import { parseHTML } from "linkedom";

import type { El } from "./dom.js";
import { classesOf } from "./dom.js";
import type { TemplateAnalysis, AnalyzedSection } from "./analyze.js";
import type { TokenizeResult, Substitution } from "./css/tokenize-css.js";

// ============================================================================
// TYPES
// ============================================================================

export interface MergedImport {
  /** Partial LayeredTheme, with the scrim colour corrected. */
  theme: Record<string, unknown>;
  /** Partial SiteContent, with scrim alpha and background images attached. */
  content: Record<string, unknown>;
  /**
   * Backgrounds that live in CSS rather than markup. A slot cannot target a
   * ::before rule, so the slotted path emits a per-site CSS rule for these
   * instead of a slot. The tokenized path just reads content.
   */
  cssBackgrounds: Array<{ sectionPath: string; selector: string; sourceUrl: string }>;
  /**
   * Backgrounds whose selector matched no section — decorative, not content.
   * Can't become an ImageAsset (nothing to attach it to), but the url() still
   * has to resolve at render time, so step 6 promotes these to bundleAssets
   * instead of dropping them.
   */
  orphanBackgrounds: Array<{ selector: string; url: string }>;
  /**
   * Sections whose scrim alpha (content.sections[].overlayOpacity) needs a
   * per-site CSS rule to actually apply — see splitScrim's doc comment. Same
   * shape as cssBackgrounds minus sourceUrl: there's no asset to download,
   * the alpha is already in content by the time this runs.
   */
  cssScrims: Array<{ sectionPath: string; selector: string; sourceSelector: string }>;
  /** Every image the template needs, for the download-and-variant step. */
  pendingAssets: Array<{ sectionPath: string; sourceUrl: string }>;
  warnings: string[];
}


// ============================================================================
// MERGE
// ============================================================================

export function merge(
  html: string,
  analysis: TemplateAnalysis,
  css: TokenizeResult,
): MergedImport {
  const { document } = parseHTML(html);
  const doc = document as unknown as El;

  const warnings: string[] = [...analysis.warnings];

  // Element -> section, so a CSS selector can be resolved back to the section
  // it styles. Built from the section selectors the markup pass already chose.
  const sectionOf = new Map<El, AnalyzedSection>();
  for (const section of analysis.sections) {
    const el = doc.querySelector(section.selector);
    if (el) sectionOf.set(el, section);
    else warnings.push(`Section selector "${section.selector}" did not resolve during merge.`);
  }

  const theme = structuredClone(css.theme);
  const overlay = splitScrim(css.substitutions, doc, sectionOf, warnings);

  if (overlay.color) setPath(theme, "core.colors.overlay", overlay.color);

  // Single source of truth for analysis-order -> content-array index. Hero is
  // excluded from content.sections[], so the two index spaces differ by one —
  // anything that builds a `sections[N]` path has to go through this map
  // rather than recomputing its own, which is exactly how pathFor() went
  // wrong the first time: it was the one place deriving the index
  // independently instead of sharing this.
  const nonHero = analysis.sections.filter((s) => !s.isHero);
  const contentIndexByOrder = new Map(nonHero.map((section, index) => [section.order, index]));

  const backgrounds = attachBackgrounds(css, doc, sectionOf, contentIndexByOrder, warnings);

  // Same join as cssBackgrounds — attach each scrim rule to the section it
  // covers via the shared pathFor(), rather than deriving sections[N] a
  // second, independent way.
  const cssScrims = overlay.entries.map(({ section, selector, sourceSelector }) => ({
    sectionPath: pathFor(section, contentIndexByOrder),
    selector,
    sourceSelector,
  }));

  checkMediaScoped(css.substitutions, warnings);

  const content = buildContent(analysis, nonHero, overlay.alphaBySection, backgrounds.bySection);

  return {
    theme,
    content,
    cssBackgrounds: backgrounds.cssBackgrounds,
    orphanBackgrounds: backgrounds.orphanBackgrounds,
    cssScrims,
    pendingAssets: backgrounds.cssBackgrounds.map(({ sectionPath, sourceUrl }) => ({
      sectionPath,
      sourceUrl,
    })),
    warnings,
  };
}

// ============================================================================
// SCRIM
// ============================================================================

interface ScrimResult {
  color?: string;
  alphaBySection: Map<AnalyzedSection, number>;
  /**
   * Section + a selector that reaches ONLY that section, pseudo included, for
   * cssScrims. Deliberately NOT the scrim rule's own selector: sources
   * routinely group the scrim under one shared rule
   * (`.hero::after, .section::after { background: rgba(...) }`) because
   * visually it's one treatment — but a per-site rule needs to set each
   * section's OWN opacity, and a shared class can't express that; every
   * section sharing it would collide on the same CSS rule. `section.selector`
   * is guaranteed unique (it's how sectionOf maps one element to one
   * section), which a background-image rule usually already is because
   * images differ per section — scrims need the same guarantee restated
   * explicitly rather than borrowed from the source's own selector.
   *
   * `sourceSelector` is kept alongside it for the OTHER consumer: neutralizing
   * SOURCE_CSS's own scrim declaration needs the selector text as CSS
   * actually wrote it (".hero::after" / ".section::after", shared across
   * every section using it), not the per-section one — a covered set built
   * from `selector` would never match the shared rule and neutralization
   * would silently no-op, exactly the failure mode neutralizeCoveredBackgrounds's
   * own doc comment warns about.
   */
  entries: Array<{ section: AnalyzedSection; selector: string; sourceSelector: string }>;
}

/**
 * Split scrim declarations into a theme colour and per-section alphas.
 *
 * A single global opacity is exactly why generated sites end up with
 * unreadable hero text — a bright photo needs ~0.6 where an already-dark one
 * needs ~0.1. Recording it per section preserves the ability to differ even
 * when the source used one value throughout.
 */
function splitScrim(
  substitutions: Substitution[],
  doc: El,
  sectionOf: Map<El, AnalyzedSection>,
  warnings: string[],
): ScrimResult {
  const scrims = substitutions.filter((s) => s.token === "core.colors.overlay");
  const alphaBySection = new Map<AnalyzedSection, number>();
  const entries: ScrimResult["entries"] = [];

  let color: string | undefined;

  for (const scrim of scrims) {
    const parsed = parseColorAlpha(scrim.original);
    if (!parsed) {
      warnings.push(`Could not parse scrim value "${scrim.original}" at ${scrim.selector}.`);
      continue;
    }

    // Sources overwhelmingly use one scrim colour with varying alpha. If two
    // rules genuinely disagree on colour, the first wins and the second is
    // reported rather than silently dropped.
    if (color && color !== parsed.color) {
      warnings.push(
        `Conflicting scrim colours: "${color}" and "${parsed.color}" — using the first.`,
      );
    }
    color ??= parsed.color;

    const pseudo = scrim.selector.match(/::(before|after)$/)?.[1];

    for (const section of sectionsFor(scrim.selector, doc, sectionOf)) {
      alphaBySection.set(section, parsed.alpha);
      entries.push({
        section,
        selector: pseudo ? `${section.selector}::${pseudo}` : section.selector,
        sourceSelector: scrim.selector,
      });
    }
  }

  if (scrims.length > 0 && alphaBySection.size === 0) {
    warnings.push(
      "A scrim was found but matched no section — check that the section selectors " +
      "and the scrim rule's selectors refer to the same elements.",
    );
  }

  return { color, alphaBySection, entries };
}

/**
 * `rgba(0,0,0,.35)` -> `{ color: "#000000", alpha: 0.35 }`.
 *
 * Returns alpha 1 for opaque forms, which is correct: an opaque scrim IS a
 * fully-applied overlay, not a missing one.
 */
export function parseColorAlpha(value: string): { color: string; alpha: number } | null {
  const trimmed = value.trim().toLowerCase();

  const rgba = trimmed.match(
    /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:[\s,/]+([\d.]+%?))?\s*\)$/,
  );
  if (rgba) {
    const [, r, g, b, a] = rgba;
    return { color: toHex(Number(r), Number(g), Number(b)), alpha: parseAlpha(a) };
  }

  // #rrggbbaa and #rgba
  const hex8 = trimmed.match(/^#([0-9a-f]{6})([0-9a-f]{2})$/);
  if (hex8) {
    return { color: `#${hex8[1]}`, alpha: Number((parseInt(hex8[2], 16) / 255).toFixed(3)) };
  }

  const hex4 = trimmed.match(/^#([0-9a-f]{3})([0-9a-f])$/);
  if (hex4) {
    const [, rgb, a] = hex4;
    const expand = rgb.split("").map((c) => c + c).join("");
    return { color: `#${expand}`, alpha: Number((parseInt(a + a, 16) / 255).toFixed(3)) };
  }

  if (/^#[0-9a-f]{6}$/.test(trimmed)) return { color: trimmed, alpha: 1 };
  if (/^#[0-9a-f]{3}$/.test(trimmed)) {
    const expand = trimmed.slice(1).split("").map((c) => c + c).join("");
    return { color: `#${expand}`, alpha: 1 };
  }
  if (trimmed === "black") return { color: "#000000", alpha: 1 };
  if (trimmed === "white") return { color: "#ffffff", alpha: 1 };

  return null;
}

const parseAlpha = (a?: string): number => {
  if (a === undefined) return 1;
  return a.endsWith("%") ? Number(a.slice(0, -1)) / 100 : Number(a);
};

const toHex = (r: number, g: number, b: number): string =>
  `#${[r, g, b].map((n) => Math.round(n).toString(16).padStart(2, "0")).join("")}`;

// ============================================================================
// BACKGROUNDS
// ============================================================================

interface BackgroundResult {
  bySection: Map<AnalyzedSection, string>;
  cssBackgrounds: MergedImport["cssBackgrounds"];
  orphanBackgrounds: MergedImport["orphanBackgrounds"];
}

/**
 * Attach each CSS background image to the section it styles.
 *
 * The markup pass produced `pendingBackgrounds` — "this section has a
 * background, defined at .starship::before". The CSS pass produced `assets` —
 * ".starship::before uses assets/img1.jpeg". Joining on the selector is the
 * only way either fact becomes usable.
 */
function attachBackgrounds(
  css: TokenizeResult,
  doc: El,
  sectionOf: Map<El, AnalyzedSection>,
  contentIndexByOrder: Map<number, number>,
  warnings: string[],
): BackgroundResult {
  const bySection = new Map<AnalyzedSection, string>();
  const cssBackgrounds: MergedImport["cssBackgrounds"] = [];
  const orphanBackgrounds: MergedImport["orphanBackgrounds"] = [];

  for (const asset of css.assets) {
    const sections = sectionsFor(asset.selector, doc, sectionOf);

    if (sections.length === 0) {
      // Not necessarily an error — a decorative background on a non-section
      // element is legitimate — but it won't be editable, so it's worth saying.
      // It still needs to resolve at render time, though: step 6 promotes it
      // to a bundleAsset rather than leaving the source's relative url() as a
      // dead reference.
      warnings.push(
        `Background "${asset.url}" at ${asset.selector} matched no section; ` +
        `it will be bundled as a static asset and won't be customisable.`,
      );
      orphanBackgrounds.push({ selector: asset.selector, url: asset.url });
      continue;
    }

    for (const section of sections) {
      if (bySection.has(section)) {
        warnings.push(
          `Section ${section.selector} has more than one background candidate; ` +
          `keeping "${bySection.get(section)}".`,
        );
        continue;
      }

      bySection.set(section, asset.url);
      cssBackgrounds.push({
        sectionPath: pathFor(section, contentIndexByOrder),
        selector: asset.selector,
        sourceUrl: asset.url,
      });
    }
  }

  // The inverse check: the markup said there was a background and the CSS pass
  // never found one. Usually means the rule is in a stylesheet that wasn't
  // handed to tokenizeCss.
  for (const pending of css.assets.length === 0 ? [] : []) void pending;

  for (const [el, section] of sectionOf) {
    if (section.roles.backgroundFrom && !bySection.has(section)) {
      warnings.push(
        `${section.selector} was expected to have a background (${section.roles.backgroundFrom}) ` +
        `but no url() was found — check that every stylesheet was passed to tokenizeCss.`,
      );
    }
    void el;
  }

  return { bySection, cssBackgrounds, orphanBackgrounds };
}

// ============================================================================
// CONTENT DRAFT
// ============================================================================

/**
 * Partial SiteContent.
 *
 * Deliberately NOT parsed against PresetContentSchema: section ids, slugs and
 * types still need minting and confirming, and failing here would hide the
 * ~90% that extracted cleanly. The authoring script parses, after review.
 */
function buildContent(
  analysis: TemplateAnalysis,
  nonHero: AnalyzedSection[],
  alphaBySection: Map<AnalyzedSection, number>,
  backgroundBySection: Map<AnalyzedSection, string>,
): Record<string, unknown> {
  const hero = analysis.sections.find((s) => s.isHero);
  // Passed in rather than re-filtered: this array's iteration order IS the
  // content.sections[] index space — pathFor() builds cssBackgrounds paths
  // against the identical array (via contentIndexByOrder) so the two can't
  // silently disagree the way pathFor() and this used to.
  const rest = nonHero;

  const appearance = (section: AnalyzedSection) => ({
    overlayOpacity: alphaBySection.get(section) ?? null,
    // Reproduce the source exactly first. The render-and-diff step is the
    // point of this pipeline, and a gradient scrim would produce a difference
    // you'd have to reason about rather than trust. Switch to "auto" after.
    overlayDirection: "uniform",
    backgroundImage: backgroundBySection.has(section)
      ? { _sourceUrl: backgroundBySection.get(section), _pending: "download + variants" }
      : undefined,
  });

  return {
    _review: [
      "Section `type` values are inferred — confirm each.",
      "Section ids and slugs are minted by the authoring script, not here.",
      "ANONYMIZE before this becomes a preset: names, addresses, socials, legal entity.",
      "Background images are source URLs pending download and variant generation.",
    ],

    hero: hero
      ? {
          kicker: hero.samples.kicker,
          title: hero.samples.title,
          body: bodyOf(hero),
          ctas: hero.samples.cta ? [{ label: hero.samples.cta, href: "TODO" }] : [],
          ...appearance(hero),
        }
      : null,

    sections: rest.map((section, index) => ({
      _sourceId: section.sourceId,
      _confidence: section.confidence,
      order: index,
      type: section.type,
      navLabel: section.navLabel ?? section.samples.title ?? "TODO",
      kicker: section.samples.kicker,
      title: section.samples.title,
      body: bodyOf(section),
      cta: section.samples.cta ? { label: section.samples.cta, href: "TODO" } : undefined,
      ...appearance(section),
    })),

    social: (analysis.nav?.social ?? []).map((s) => ({
      platform: s.platform,
      label: s.platform,
      url: s.href,
      showInNav: true,
    })),

    footer: { disclaimer: "TODO", legal: { copyrightYear: "auto" } },
  };
}

const bodyOf = (section: AnalyzedSection): string[] =>
  section.roles.body.map((_, i) => section.samples[`body[${i}]`]).filter(Boolean);

// ============================================================================
// CHECKS
// ============================================================================

/**
 * Some rules are only correct inside a media query. `.nav-links { background }`
 * is the mobile drawer — the same selector outside the query is the desktop
 * link row, and mapping it to mobileMenuBackground would be wrong.
 */
function checkMediaScoped(substitutions: Substitution[], warnings: string[]): void {
  for (const sub of substitutions) {
    if (sub.token === "semantic.mobileMenuBackground" && !sub.media) {
      warnings.push(
        `${sub.selector} { ${sub.property} } mapped to mobileMenuBackground but is not ` +
        `inside a media query — confirm this is the drawer and not the desktop nav.`,
      );
    }
  }
}

// ============================================================================
// HELPERS
// ============================================================================

/**
 * Resolve a CSS selector — possibly carrying a pseudo-element — to the
 * sections it styles.
 *
 * The pseudo must be stripped before querying: `.hero::after` matches nothing
 * via querySelectorAll, and silently returning zero sections is how the scrim
 * and every background go missing at once.
 */
function sectionsFor(
  selector: string,
  doc: El,
  sectionOf: Map<El, AnalyzedSection>,
): AnalyzedSection[] {
  const base = selector.replace(/::?(before|after|first-line|first-letter)\b/g, "").trim();
  if (!base) return [];

  let matches: El[];
  try {
    matches = Array.from(doc.querySelectorAll(base));
  } catch {
    return [];
  }

  const out: AnalyzedSection[] = [];

  for (const el of matches) {
    const direct = sectionOf.get(el);
    if (direct) { out.push(direct); continue; }

    // A rule may target a section by class where the section was identified by
    // id. Fall back to a class check against the section elements themselves.
    for (const [sectionEl, section] of sectionOf) {
      if (sectionEl === el) { out.push(section); break; }
      const cls = base.startsWith(".") ? base.slice(1) : null;
      if (cls && classesOf(sectionEl).has(cls) && !out.includes(section)) {
        out.push(section);
        break;
      }
    }
  }

  return out;
}

/**
 * Content path, with the hero excluded from `sections` numbering.
 *
 * `section.order` is the analysis-level index and counts the hero section
 * (hero=0, first real section=1, ...), but `content.sections[]` excludes the
 * hero and restarts at 0 — so `sections[${section.order}]` is off by one for
 * every non-hero section, and out of bounds for the last one.
 *
 * `contentIndexByOrder` is merge()'s single computation of that mapping —
 * built once from the same `nonHero` filter buildContent() consumes, so
 * every `sections[N]` path in this file's output agrees with every other.
 * This function does not re-derive the index itself, on purpose: that's
 * exactly how it went wrong the first time.
 */
function pathFor(section: AnalyzedSection, contentIndexByOrder: Map<number, number>): string {
  if (section.isHero) return "hero";

  const index = contentIndexByOrder.get(section.order);
  if (index === undefined) {
    // A section pathFor() is asked about but that never made it into
    // content.sections[] — fail loudly. The alternative is a path that
    // resolves to undefined at render time and ships silently, which is
    // exactly the bug this replaced.
    throw new Error(
      `No content index for section order=${section.order} (${section.selector}) — ` +
      `it isn't hero and isn't in the non-hero content list.`,
    );
  }

  return `sections[${index}]`;
}

function setPath(root: Record<string, unknown>, path: string, value: unknown): void {
  const parts = path.split(".");
  let cursor = root;

  for (const key of parts.slice(0, -1)) {
    if (typeof cursor[key] !== "object" || cursor[key] === null) cursor[key] = {};
    cursor = cursor[key] as Record<string, unknown>;
  }

  cursor[parts[parts.length - 1]] = value;
}