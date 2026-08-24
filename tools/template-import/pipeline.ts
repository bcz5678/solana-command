// ============================================================================
// tools/template-import/pipeline.ts
//
// Pure orchestration. No fs, no process, no console — so the CLI and a future
// review UI call the same function and cannot drift.
//
// Pass order is fixed and not parallelisable: countHeadings feeds tokenizeCss,
// and merge needs both results.
//
//   markup -> headings -> css -> merge -> overrides -> artifacts
//
// Overrides are applied LAST, so a human correction always wins over an
// inference regardless of which pass produced it.
// ============================================================================

import { analyze, type TemplateAnalysis, type AnalyzedSection, type HeadingUsage } from "./analyze.js";
import { tokenizeCss, normalizeValue, detectTokenCollisions, MOBILE_SCOPED, type TokenizeResult, type Substitution } from "./css/tokenize-css.js";
import { merge, type MergedImport } from "./merge.js";

// ============================================================================
// OVERRIDES — the one authored file
// ============================================================================

/**
 * Human corrections. The tool NEVER writes this; everything it does write goes
 * under .generated/ and is disposable. That split is what makes "correct the
 * spec, re-run" safe rather than a convention people have to remember.
 *
 * Keys are the stable identifiers each pass emits: section source ids, and
 * `selector|property` for substitutions.
 */
export interface Overrides {
  sections?: Record<string, {
    type?: string;
    navLabel?: string;
    isHero?: boolean;
    ignore?: boolean;
    /**
     * Skip repeater detection in this section.
     *
     * The escape hatch for a false positive. A wrong detection excludes real
     * body copy from readRoles, so the content silently disappears rather than
     * duplicating — worse than the problem the exclusion solves.
     */
    ignoreRepeaters?: boolean;
    /**
     * The section's "button" isn't a CTA — it's a widget (a copy-to-clipboard
     * address, say) that a generic link slot would flatten if it were mapped
     * as one. Clears roles.cta and samples.cta so buildSpecDraft never
     * generates the slot in the first place; the durable fix, since the
     * alternative is deleting the slot from spec.draft.json by hand on every
     * re-run. Generalizes to any source whose "button" isn't really a link.
     */
    ignoreCta?: boolean;
  }>;

  substitutions?: {
    /** "selector|property" -> token path. Retokenize a wrong mapping. */
    retoken?: Record<string, string>;
    /** "selector|property" entries to drop — a literal that should stay literal. */
    remove?: string[];
    /** Declarations the rule table missed. */
    add?: Array<{ selector: string; property: string; token: string; original: string }>;
  };

  typeScale?: {
    /** Heading tags to exclude from the fit — usually ones used as labels. */
    excludeHeadings?: string[];
    /** Pin the ratio outright when the source doesn't fit any scale. */
    scaleRatio?: number;
    baseFontSize?: string;
  };

  /** Dotted content paths to replace before this becomes a preset. */
  anonymize?: Record<string, string>;

  /** Origins permitted in @import and url(). */
  allowedOrigins?: string[];
    /**
    * Differences the reviewer has accepted as intentional. Downgrades a
    * verify difference from "unexpected" to "expected", with the reason shown
    * in the report.
    *
    * `property` is matched anchored; `selector` is not, so a partial selector
    * covers every element it appears in.
    */
   verify?: {
     expected?: Array<{
              /** Exact property name, e.g. "letter-spacing". */
      property: string;
       /** Optional selector constraint, matched unanchored. */
       selector?: string;
       /** Why this difference is acceptable. Shown grouped in the report. */
       reason: string;
     }>;
   };
}

// ============================================================================
// ARTIFACTS
// ============================================================================

export interface ImportArtifacts {
  analysis: TemplateAnalysis;
  css: TokenizeResult;
  merged: MergedImport;
  /** Draft SlottedSpec — selectors. */
  spec: Record<string, unknown>;
  /** Everything a reviewer needs to act on, ranked. */
  review: ReviewItem[];
  warnings: string[];
}

export interface ReviewItem {
  severity: "blocker" | "confirm" | "note";
  /** Where to make the correction, in overrides.json terms. */
  at: string;
  message: string;
}

export interface PipelineInput {
  html: string;
  css: string;
  overrides?: Overrides;
  /** Used for SlottedSpec.sourceKey. */
  templateName: string;
}

// ============================================================================
// RUN
// ============================================================================

export function runImport(input: PipelineInput): ImportArtifacts {
  const { html, css, templateName } = input;
  const overrides = input.overrides ?? {};

  // 1. Markup. Heading counts come back on the analysis now — computing them
  //    separately is how the two would drift.
  const analysis = applySectionOverrides(
    analyze(html, { ignoreRepeatersIn: ignoredSections(overrides) }),
    overrides,
  );

  // 2. CSS. Exclusions force a heading's count to 1, which is how fitTypeScale
  //    already drops label-only tags — one mechanism, not two.
  const cssResult = applySubstitutionOverrides(
    tokenizeCss(css, {
      headingUsage: withExclusions(analysis.headingUsage, overrides),
      allowedOrigins: overrides.allowedOrigins ?? [],
    }),
    overrides,
  );

  // 3. Join.
  const merged = merge(html, analysis, cssResult);

  applyTypeScaleOverride(merged, overrides);
  applyAnonymize(merged, overrides);

  return {
    analysis,
    css: cssResult,
    merged,
    spec: buildSpecDraft(analysis, templateName),
    review: buildReview(analysis, cssResult, merged),
    warnings: merged.warnings,
  };
}

// ============================================================================
// OVERRIDE APPLICATION
// ============================================================================

function applySectionOverrides(analysis: TemplateAnalysis, overrides: Overrides): TemplateAnalysis {
  const bySource = overrides.sections ?? {};

  const sections = analysis.sections
    .filter((s) => !bySource[s.sourceId]?.ignore)
    .map((section) => {
      const patch = bySource[section.sourceId];
      if (!patch) return section;

      const samples = { ...section.samples };
      if (patch.ignoreCta) delete samples.cta;

      return {
        ...section,
        type: (patch.type ?? section.type) as AnalyzedSection["type"],
        navLabel: patch.navLabel ?? section.navLabel,
        isHero: patch.isHero ?? section.isHero,
        // Cleared together: roles.cta drives buildSpecDraft's slot, samples.cta
        // drives merge.ts's content draft. Leaving samples.cta behind would
        // still seed a `{ label, href: "TODO" }` placeholder with no slot to
        // ever fill it.
        roles: patch.ignoreCta ? { ...section.roles, cta: undefined } : section.roles,
        samples,
        // A confirmed section is no longer an inference — but only an explicit
        // type correction confirms it. A patch that sets only ignoreRepeaters
        // or navLabel must not silently drop the section from the "confirm
        // type" review queue for a type nobody actually looked at.
        confidence: patch.type !== undefined ? 1 : section.confidence,
      };
    })
    // `order` is positional and must stay dense after an ignore.
    .map((section, index) => ({ ...section, order: index }));

  return { ...analysis, sections };
}

function withExclusions(
  usage: Record<string, HeadingUsage>,
  overrides: Overrides,
): Record<string, HeadingUsage> {
  const excluded = overrides.typeScale?.excludeHeadings ?? [];
  if (excluded.length === 0) return usage;

  // fitTypeScale drops any tag with zero structural uses, so an explicit
  // exclusion reaches it through that same mechanism rather than a second one.
  const out = { ...usage };
  for (const tag of excluded) {
    if (tag in out) out[tag] = { ...out[tag], structural: 0 };
  }
  return out;
}

function applySubstitutionOverrides(
  result: TokenizeResult,
  overrides: Overrides,
): TokenizeResult {
  const patch = overrides.substitutions;
  if (!patch) return result;

  const key = (s: { selector: string; property: string }) => `${s.selector}|${s.property}`;
  const removed = new Set(patch.remove ?? []);
  const retoken = patch.retoken ?? {};

  const substitutions: Substitution[] = result.substitutions
    .filter((s) => !removed.has(key(s)))
    .map((s) =>
      retoken[key(s)]
        ? { ...s, token: retoken[key(s)], confidence: 1, note: "Set by override." }
        : s,
    );

  for (const added of patch.add ?? []) {
    substitutions.push({ ...added, confidence: 1, note: "Added by override." });
  }

  // Collision findings are derived from substitutions too, and a retoken can
  // both create a new collision and resolve an old one — appending fresh
  // findings on top of result.findings would leave a resolved collision's
  // finding sitting there stale. detectTokenCollisions is pure and
  // deterministic, so recomputing it against the ORIGINAL substitutions
  // reproduces exactly the strings tokenizeCss pushed, safe to filter out by
  // equality before adding the current ones.
  const staleCollisions = new Set(detectTokenCollisions(result.substitutions));
  const findings = [
    ...result.findings.filter((f) => !staleCollisions.has(f)),
    ...detectTokenCollisions(substitutions),
  ];

  // The theme draft is derived from substitutions, so it has to be rebuilt
  // rather than patched — otherwise a retoken leaves the old path populated.
  return { ...result, substitutions, findings, theme: rebuildTheme(substitutions, result) };
}

function rebuildTheme(
  substitutions: Substitution[],
  original: TokenizeResult,
): Record<string, unknown> {
  const theme: Record<string, unknown> = {};

  // normalizeValue, not sub.original directly — some tokens (lineHeightBase,
  // fontWeightBold, ...) are typed as numbers in LayeredThemeSchema, and every
  // substitution's `original` is a raw CSS string. buildThemeDraft() already
  // gets this right; skipping it here is how a retoken override — or just the
  // `substitutions: {}` init always seeds overrides.json with, which is enough
  // to make this path run every time — reintroduced the exact type mismatch.

  // Shared with buildThemeDraft (tokenize-css.ts) rather than a second copy —
  // two independently maintained sets is exactly how they'd quietly disagree.
  for (const sub of substitutions) {
    if (sub.media && !MOBILE_SCOPED.has(sub.token)) continue;
    setPath(theme, sub.token, normalizeValue(sub.token, sub.property, sub.original));
  }

  // Type-scale and breakpoint values aren't substitutions, so carry them over.
  for (const path of [
    "core.typography.baseFontSize",
    "core.typography.scaleRatio",
    "core.typography.scaleRatioMobile",
    "core.breakpoints.md",
  ]) {
    const value = getPath(original.theme, path);
    if (value !== undefined) setPath(theme, path, value);
  }

  return theme;
}

function applyTypeScaleOverride(merged: MergedImport, overrides: Overrides): void {
  const patch = overrides.typeScale;
  if (!patch) return;

  if (patch.scaleRatio !== undefined) {
    setPath(merged.theme, "core.typography.scaleRatio", patch.scaleRatio);
  }
  if (patch.baseFontSize !== undefined) {
    setPath(merged.theme, "core.typography.baseFontSize", patch.baseFontSize);
  }
}

/**
 * Replace identifying content before it becomes a preset.
 *
 * Applied here rather than left to a reviewer's memory: a preset ships to every
 * site created from the template, so a real contract address or company name
 * escaping this step is a genuine hazard, not an embarrassment.
 */
function applyAnonymize(merged: MergedImport, overrides: Overrides): void {
  for (const [path, value] of Object.entries(overrides.anonymize ?? {})) {
    setPath(merged.content as Record<string, unknown>, path, value);
  }
}

/** Source ids whose repeater detection is switched off. */
function ignoredSections(overrides: Overrides): string[] {
  return Object.entries(overrides.sections ?? {})
    .filter(([, patch]) => patch.ignoreRepeaters)
    .map(([sourceId]) => sourceId);
}

// ============================================================================
// SPEC DRAFT
// ============================================================================

function buildSpecDraft(analysis: TemplateAnalysis, templateName: string) {
  const slots: unknown[] = [];
  const repeaters: unknown[] = [];

  const nonHero = analysis.sections.filter((s) => !s.isHero);

  for (const section of analysis.sections) {
    const base = section.isHero ? "hero" : `sections[${nonHero.indexOf(section)}]`;
    const scope = section.selector;

    // Unscoped, ".kicker" matches every section and writes one value to all.
    const at = (relative?: string) => (relative ? `${scope} ${relative}` : undefined);

    push(slots, at(section.roles.kicker), `${base}.kicker`, "text");
    push(slots, at(section.roles.title), `${base}.title`, "text");
    section.roles.body.forEach((rel, i) => push(slots, at(rel), `${base}.body[${i}]`, "text"));
    push(slots, at(section.roles.cta), section.isHero ? `${base}.ctas[0]` : `${base}.cta`, "link");

    for (const repeater of section.repeaters) {
      repeaters.push({
        _hint: repeater.sectionTypeHint,
        _confidence: repeater.confidence,
        // NOT scoped with `${scope} ` — detectRepeatersIn's own selector
        // construction (cssPath, buildItemSelector) already verifies against
        // the whole document, so these are complete selectors on their own.
        // Prepending scope produced "#features #features" whenever the
        // container itself was the id-selectable element, which — now that
        // detectRepeatersIn treats a section's own direct children as a
        // candidate group — is the common case, not a rare one.
        selector: repeater.selector,
        containerSelector: repeater.containerSelector,
        path: `${base}.TODO`,
        max: Math.max(repeater.count * 2, 12),
        slots: repeater.fields
          .filter((f) => !f.constant)
          .map((f) => ({ selector: f.selector, path: "TODO", mode: f.mode })),
      });
    }
  }

  return {
    sourceKey: `${templateName}@1`,
    slots,
    repeaters,
    sanitize: { approvedScripts: [], allowedOrigins: [], stripSelectors: [] },
    metaInsertSelector: "head",
    rewriteAnchors: true,
  };
}

function push(
  target: unknown[],
  selector: string | undefined,
  path: string,
  mode: "text" | "link" | "image",
): void {
  if (selector) target.push({ selector, path, mode });
}

// ============================================================================
// REVIEW QUEUE
// ============================================================================

/**
 * What a human has to act on, and nothing else.
 *
 * A queue rather than a dump: if a reviewer reads a confidently-extracted
 * meta.title, the throughput argument for the whole pipeline is lost.
 */
function buildReview(
  analysis: TemplateAnalysis,
  css: TokenizeResult,
  merged: MergedImport,
): ReviewItem[] {
  const items: ReviewItem[] = [];

  for (const section of analysis.sections) {
    if (section.confidence < 1) {
      items.push({
        severity: "confirm",
        at: `sections["${section.sourceId}"].type`,
        message: `Type inferred as "${section.type}" (confidence ${section.confidence}).`,
      });
    }
  }

  if (css.typeScale?.note) {
    items.push({ severity: "confirm", at: "typeScale", message: css.typeScale.note });
  }

  for (const finding of css.findings) {
    items.push({
      severity: /disallowed origin/.test(finding) ? "blocker" : "note",
      at: "substitutions",
      message: finding,
    });
  }

  for (const sub of css.substitutions.filter((s) => s.confidence < 0.7)) {
    items.push({
      severity: "confirm",
      at: `substitutions.retoken["${sub.selector}|${sub.property}"]`,
      message: `Mapped to ${sub.token} at confidence ${sub.confidence}. ${sub.note ?? ""}`.trim(),
    });
  }

  for (const gap of css.unmapped.filter((u) => u.reason === "unrecognised")) {
    items.push({
      severity: "note",
      at: `substitutions.add`,
      message: `Unmapped: ${gap.selector} { ${gap.property}: ${gap.value} }`,
    });
  }

  // Always a blocker. A preset carrying a real contract address or company name
  // ships it to every site created from the template.
  items.push({
    severity: "blocker",
    at: "anonymize",
    message: "Anonymize brand, contract address, socials and legal entity before authoring the preset.",
  });

  for (const warning of merged.warnings) {
    items.push({ severity: "note", at: "-", message: warning });
  }

  const rank = { blocker: 0, confirm: 1, note: 2 };
  return items.sort((a, b) => rank[a.severity] - rank[b.severity]);
}

// ============================================================================
// HELPERS
// ============================================================================

function setPath(root: Record<string, unknown>, path: string, value: unknown): void {
  // Supports `sections[0].title` as well as dotted paths.
  const parts = path.split(/\.|\[(\d+)\]/).filter((p) => p !== "" && p !== undefined);
  let cursor: Record<string, unknown> = root;

  for (let i = 0; i < parts.length - 1; i++) {
    const key = parts[i];
    if (typeof cursor[key] !== "object" || cursor[key] === null) {
      cursor[key] = /^\d+$/.test(parts[i + 1]) ? [] : {};
    }
    cursor = cursor[key] as Record<string, unknown>;
  }

  cursor[parts[parts.length - 1]] = value;
}

function getPath(root: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>(
    (cursor, key) =>
      cursor && typeof cursor === "object"
        ? (cursor as Record<string, unknown>)[key]
        : undefined,
    root,
  );
}