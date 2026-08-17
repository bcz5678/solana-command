// ============================================================================
// tools/template-import/analyze.ts
//
// The one entry point. The CLI and any future review UI call this and nothing
// else, so the pass structure stays an implementation detail.
//
// Order matters and is not parallelisable:
//
//   detect-sections    page structure — hero, sections, nav, social
//   detect-repeaters   repetition INSIDE a section, scoped per section
//   readRoles          kicker/title/body/cta, EXCLUDING repeater items
//
// Repeaters run before roles because roles must not reach into a repeated
// region. A card's <h3> reaching readRoles becomes the section's heading, and
// kicker detection is computed against that heading's position — so filtering
// duplicates out afterwards removes the wrong entries but leaves the wrong
// index. Excluding up front is the only ordering that produces both correctly.
// ============================================================================

import { parseHTML } from "linkedom";

import type { El } from "./dom.js";
import { text } from "./dom.js";
import {
  detectSections,
  readRoles,
  type SectionCandidate,
  type SectionRoles,
  type NavCandidate,
} from "./detect-sections.js";
import {
  detectRepeatersIn,
  type RepeaterCandidate,
  type SectionTypeHint,
} from "./detect-repeaters.js";

export interface AnalyzedSection extends SectionCandidate {
  /** Maps to SiteSection.type. */
  type: SectionTypeHint;
  /** Empty for prose sections, which is the common case. */
  repeaters: RepeaterCandidate[];
  /** Relative selectors per role, ready to become Slots. */
  roles: SectionRoles;
  /** Resolved values, for the content draft and the report. */
  samples: Record<string, string>;
}

export interface TemplateAnalysis {
  /** Owns nav links and social links. Neither becomes a section. */
  nav: NavCandidate | null;
  sections: AnalyzedSection[];
  /**
   * Sections whose background lives in CSS rather than markup. The stylesheet
   * pass fills these; on this class of template it's where every image is.
   */
  pendingBackgrounds: Array<{ section: string; from: string }>;
  /** Feeds tokenizeCss's type-scale fit. A tag used once is usually a label. */
  headingUsage: Record<string, number>;
  /**
   * `<link rel="stylesheet">` hrefs found in source.html. Re-derived here
   * rather than threaded through from normalize.ts's NormalizeResult — init
   * only ever logged that field, so it was lost the moment the run ended.
   * emit needs it to warn when a linked sheet was never tokenized.
   */
  linkedStylesheets: string[];
  warnings: string[];
}

export interface AnalyzeOptions {
  /**
   * Source ids whose repeater detection should be skipped.
   *
   * The escape hatch for a false positive. Without it a wrong detection
   * silently removes real body copy from the roles, which is a worse failure
   * than the duplicate slots it was meant to prevent.
   */
  ignoreRepeatersIn?: string[];
}

export function analyze(html: string, options: AnalyzeOptions = {}): TemplateAnalysis {
  const { document } = parseHTML(html);
  const doc = document as unknown as El;

  const { nav, sections } = detectSections(html);
  const warnings: string[] = [];

  if (sections.length === 0) {
    warnings.push("No sections found — check for <section> elements or in-page nav anchors.");
  }
  if (!nav) {
    warnings.push("No nav found — section labels and social links will need writing by hand.");
  }

  const analyzed: AnalyzedSection[] = sections.map((section) => {
    const el = doc.querySelector(section.selector);

    if (!el) {
      warnings.push(`Section selector "${section.selector}" did not resolve.`);
      return { ...section, type: "prose", repeaters: [], roles: { body: [] }, samples: {} };
    }

    const suppressed = options.ignoreRepeatersIn?.includes(section.sourceId) ?? false;

    // Scoped to the section; `doc` passed separately because selector
    // verification — "does this class match more nodes than my group?" — has to
    // check the whole document. Candidates with no varying field are dropped:
    // three empty spans are a hamburger icon, not a content array.
    const repeaters = suppressed
      ? []
      : detectRepeatersIn(el, doc)
          .filter((r) => r.fields.some((f) => !f.constant))
          .sort((a, b) => b.confidence - a.confidence);

    // Every item of every surviving repeater. Roles must not reach into these:
    // the repeater already covers them, and duplicate slots would race to
    // overwrite the same node while the repeater re-populates it.
    const items = repeaters.flatMap((r) => Array.from(doc.querySelectorAll(r.selector)));

    const roles: SectionRoles = {
      ...readRoles(el, items),
      backgroundFrom: section.backgroundFrom,
    };

    return {
      ...section,
      type: repeaters[0]?.sectionTypeHint ?? "prose",
      repeaters,
      roles,
      samples: sampleRoles(el, roles),
    };
  });

  const pendingBackgrounds = analyzed
    .filter((s) => s.roles.backgroundFrom)
    .map((s) => ({ section: s.selector, from: s.roles.backgroundFrom! }));

  return {
    nav,
    sections: analyzed,
    pendingBackgrounds,
    headingUsage: countHeadings(doc),
    linkedStylesheets: linkedStylesheetsOf(doc),
    warnings,
  };
}

// ============================================================================
// SAMPLES
// ============================================================================

/**
 * Resolve each role selector to its text.
 *
 * Keys mirror the content paths the drafts use — `body[0]`, `body[1]` — so
 * merge can read them positionally without a second convention.
 */
function sampleRoles(section: El, roles: SectionRoles): Record<string, string> {
  const out: Record<string, string> = {};
  const read = (selector: string) => text(section.querySelector(selector));

  if (roles.kicker) out.kicker = read(roles.kicker);
  if (roles.title) out.title = read(roles.title);
  if (roles.cta) out.cta = read(roles.cta);
  roles.body.forEach((selector, i) => { out[`body[${i}]`] = read(selector); });

  return out;
}

/**
 * Heading counts across the whole document.
 *
 * Returned here rather than computed separately in merge, because the CSS pass
 * needs it and duplicating the count is how the two drift.
 */
function countHeadings(doc: El): Record<string, number> {
  const counts: Record<string, number> = {};

  for (const tag of ["h1", "h2", "h3", "h4", "h5", "h6"]) {
    const n = doc.querySelectorAll(tag).length;
    if (n > 0) counts[tag] = n;
  }

  return counts;
}

function linkedStylesheetsOf(doc: El): string[] {
  return Array.from(doc.querySelectorAll('link[rel="stylesheet"]'))
    .map((el) => el.getAttribute("href"))
    .filter((href): href is string => Boolean(href));
}

// ============================================================================
// REPORT
// ============================================================================

export function formatAnalysis(analysis: TemplateAnalysis): string {
  const lines: string[] = [];

  if (analysis.nav) {
    lines.push(`NAV  ${analysis.nav.selector}`);
    for (const a of analysis.nav.anchors) lines.push(`  ${a.href.padEnd(14)} "${a.label}"`);
    for (const s of analysis.nav.social) lines.push(`  social: ${s.platform.padEnd(10)} ${s.href}`);
    lines.push("");
  }

  lines.push(`${analysis.sections.length} section(s)\n`);

  for (const section of analysis.sections) {
    lines.push(
      `${String(section.order).padStart(2)}. ${section.selector.padEnd(14)} ` +
      `${section.type.toUpperCase().padEnd(9)} ` +
      `${section.isHero ? "HERO " : "     "}` +
      `conf ${section.confidence}` +
      (section.navLabel ? `  "${section.navLabel}"` : "  (no nav label)"),
    );

    for (const [role, value] of Object.entries(section.samples)) {
      lines.push(`      ${role.padEnd(10)} ${value}`);
    }
    if (section.roles.backgroundFrom) {
      lines.push(`      background  ${section.roles.backgroundFrom}  → needs CSS pass`);
    }
    for (const r of section.repeaters) {
      lines.push(`      repeater    ${r.selector} (${r.count} items, ${r.sectionTypeHint})`);
    }
    for (const note of section.notes) lines.push(`      ! ${note}`);
    lines.push("");
  }

  for (const warning of analysis.warnings) lines.push(`! ${warning}`);

  return lines.join("\n");
}