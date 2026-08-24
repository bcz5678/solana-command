// ============================================================================
// tools/template-import/verify.ts
//
// STEP 9 — prove the tokenization was lossless.
//
// Renders the preset through the emitted template and compares COMPUTED styles
// against the source, property by property, in a real browser.
//
// Computed styles rather than screenshots, as the primary check: the most
// likely error is a token mapped to the wrong property, and that is frequently
// invisible in a screenshot. `--st-color-primary` wired to `border-color`
// instead of `background-color` on a white-on-white button looks identical and
// breaks the moment a customer picks a colour.
//
// PREREQUISITE — the render must actually emit the token block. rewriteCss
// produces `var(--st-x, <original literal>)`, so a page missing `:root{--st-…}`
// falls back to every source literal and this diff passes while testing
// nothing. assertTokensPresent() guards it; do not remove.
//
// Build-time only. Needs playwright (dev dependency).
// ============================================================================

import { chromium, type Page } from "playwright";

import { findUnrewritten, type Substitution } from "./css/tokenize-css.js";
import type { TemplateAnalysis } from "./analyze.js";

// ============================================================================
// TYPES
// ============================================================================

export interface Target {
  selector: string;
  pseudo?: "before" | "after";
}

export interface Difference {
  selector: string;
  pseudo?: string;
  /** Nth match, when a selector matches several elements. */
  index: number;
  property: string;
  source: string;
  rendered: string;
  classification: "expected" | "unexpected";
  reason?: string;
}

export interface VerifyResult {
  differences: Difference[];
  /** Selectors whose match COUNT differs — a structural change, not a style one. */
  structural: Array<{ selector: string; source: number; rendered: number }>;
  unexpected: number;
  warnings: string[];
  /** Distinct selector/pseudo targets attempted — not all necessarily matched. */
  targetCount: number;
  /**
   * Elements actually found on the SOURCE page, across every target. Zero
   * here means nothing was compared — reported separately from `differences`
   * because an empty target list and a flawless render produce the identical
   * "0 unexpected, 0 expected, 0 structural" shape otherwise.
   */
  probeCount: number;
  /**
   * Substitutions tokenize.report.json claims were mapped, but that don't
   * appear as `var(--st-…)` anywhere in the rendered CSS at their own
   * selector/property. Computed-value diffing structurally cannot see this:
   * a substitution that silently never made it into the stylesheet renders
   * the source's own literal, which trivially equals the source — no
   * difference, nothing to classify, nothing in `differences` at all.
   */
  untokenized: UntokenizedSubstitution[];
}

export interface UntokenizedSubstitution {
  selector: string;
  property: string;
  token: string;
}

export interface VerifyOptions {
  /**
   * Differences known to be intentional. Each is matched against a difference
   * and, on a hit, downgrades it to "expected" with the given reason.
   *
   * Passed in rather than hardcoded because they're per-template decisions —
   * whether a type-scale residual is acceptable is a judgement made at import,
   * not a property of the tool.
   */
  expected?: ExpectedRule[];
  /** Extra selectors beyond those derived from the substitution map. */
  extraTargets?: Target[];
  /**
   * Independently-computed expected URL for each cssBackgrounds target,
   * keyed `${selector}::${pseudo ?? ""}` — resolve preset.content through the
   * same image resolver renderSlotted used, not read back from the render
   * under test. Without this, "changed to some /media/-shaped value" is the
   * strongest claim background-image differences can make, and that's
   * exactly the shape a wrong-but-well-formed URL has — it's what let three
   * of spacex-ipo's four backgrounds ship pointing at a neighboring
   * section's image undetected.
   */
  expectedBackgroundUrls?: Map<string, string>;
}

export interface ExpectedRule {
  /** Matched against the property name. */
  property: RegExp;
  /** Optional selector constraint. */
  selector?: RegExp;
  /**
   * Optional extra condition on the difference. Exists because some
   * expectations are about the VALUES, not just which property differs — a
   * rule that matches on property alone can end up excusing the exact
   * failure it was written to tolerate the absence of. "background-image
   * differs because seed images aren't fetched yet" and "background-image
   * differs because the per-site rule never fired" produce the identical
   * (property, selector) match; only the values tell them apart.
   */
  when?: (d: Difference) => boolean;
  reason: string;
}

// ============================================================================
// PROPERTIES
// ============================================================================

/**
 * The properties worth comparing.
 *
 * Not all ~340 computed properties: most are structural defaults that agree
 * trivially and bury the handful that matter. This list is everything the rule
 * table can produce, plus the inherited properties a wrong mapping would
 * disturb.
 */
const PROPERTIES = [
  "color",
  "background-color",
  "background-image",
  "background-position",
  "font-family",
  "font-size",
  "font-weight",
  "line-height",
  "letter-spacing",
  "text-transform",
  "text-align",
  "padding-top", "padding-right", "padding-bottom", "padding-left",
  "margin-bottom",
  "border-top-color", "border-top-width", "border-top-style",
  "border-radius",
  "max-width",
  "min-height",
  "transition-duration",
  "backdrop-filter",
  "opacity",
] as const;

/**
 * Defaults every template shares. Applied before any per-template rules, since
 * these follow from decisions made in the pipeline itself rather than from a
 * particular source.
 */
export const BASELINE_EXPECTED: ExpectedRule[] = [
  {
    property: /^font-size$/,
    selector: /^h[1-6]/,
    reason: "Heading sizes are generated from baseFontSize x scaleRatio; the source's were hand-set.",
  },
  {
    property: /^letter-spacing$/,
    reason: "Source used several arbitrary values; they collapse to one token.",
  },
  {
    property: /^background-image$/,
    // Without `when`, this excused BOTH the tolerable case (source's
    // relative path resolves differently than the resolver's absolute one)
    // AND the failure it wasn't written for: `rendered: "none"` means the
    // per-site cssBackgrounds rule never fired at all — image missing from
    // content, a selector/pseudo mismatch, whatever — and that must stay
    // unexpected. Caught for real: spacex-ipo's four backgrounds were
    // reporting "none" and this rule was quietly forgiving it.
    when: (d) => d.rendered !== "none" && d.rendered.trim() !== "",
    reason: "Source references a relative path; rendered resolves through the image resolver.",
  },
  {
    property: /^font-family$/,
    reason: "Source may reference a font it never loaded; the preset declares a deliberate stack.",
  },
];

// ============================================================================
// ENTRY POINT
// ============================================================================

export async function verifyRender(
  sourceHtml: string,
  renderedHtml: string,
  substitutions: Substitution[],
  analysis: TemplateAnalysis,
  options: VerifyOptions = {},
): Promise<VerifyResult> {
  const warnings: string[] = [];

  assertTokensPresent(renderedHtml);

  const targets = buildTargets(substitutions, analysis, options.extraTargets ?? []);

  // Identity rule goes FIRST: .find() below stops at the first match, and
  // this has to be asked before the loose baseline rule ("any non-none
  // value is fine") gets a chance to excuse a wrong-but-real URL. When a
  // selector has no independent expectation (not a cssBackgrounds target,
  // or expectedBackgroundUrls wasn't supplied at all), `when` returns false
  // and the baseline rule underneath still applies normally.
  const rules: ExpectedRule[] = [];
  if (options.expectedBackgroundUrls) {
    rules.push(backgroundIdentityRule(options.expectedBackgroundUrls));
  }
  rules.push(...BASELINE_EXPECTED, ...(options.expected ?? []));

  // Cheap and needs no browser — run before the Playwright probe rather than
  // after, so a template that fails it loudly doesn't still pay for a
  // browser launch.
  const untokenized = checkTokenizationCoverage(renderedHtml, substitutions);

  const browser = await chromium.launch();

  try {
    const source = await probe(browser, sourceHtml, targets);
    const rendered = await probe(browser, renderedHtml, targets);

    // Zero of everything means no comparison happened, not that the render
    // matched — the same failure assertTokensPresent guards against, one
    // level up: a clean report that tested nothing. A too-narrow target list
    // (empty substitutions/sections) or a source page that failed to
    // populate produces exactly "0 unexpected, 0 expected, 0 structural",
    // indistinguishable from a flawless render unless this is checked.
    if (source.size === 0) {
      throw new Error(
        `No elements were probed — ${targets.length} target selector(s) matched ` +
        `nothing on the source page. Check that .generated/analysis.json has ` +
        `sections and tokenize.report.json has substitutions; an empty target ` +
        `list produces a clean report that means nothing.`,
      );
    }

    return compare(source, rendered, rules, warnings, targets.length, untokenized);
  } finally {
    await browser.close();
  }
}

/**
 * `background-image` classified "expected" only when it resolves to the
 * SAME URL independently derived from preset.content — not merely a
 * non-"none" value. See VerifyOptions.expectedBackgroundUrls.
 */
export function backgroundIdentityRule(expectedUrls: Map<string, string>): ExpectedRule {
  return {
    property: /^background-image$/,
    when: (d) => {
      const expected = expectedUrls.get(`${d.selector}::${d.pseudo ?? ""}`);
      if (expected === undefined) return false; // not a tracked target — defer to the baseline rule

      // getComputedStyle() resolves a root-relative url() (what the resolver
      // returns, e.g. "/media/x.webp") to an absolute one against the page's
      // own origin. page.setContent() has no real origin, so exact string
      // equality never holds even for a genuinely correct match — the
      // resolved path is always a SUFFIX of the computed value, not equal
      // to it.
      const unquoted = d.rendered.replace(/^url\((['"]?)(.*)\1\)$/, "$2");
      return unquoted.endsWith(expected);
    },
    reason: "Resolves to the URL independently computed from preset.content through the same image resolver.",
  };
}

/**
 * Every substitution tokenize.report.json claims was mapped, checked for a
 * `var(--st-…)` reference at its own selector/property in the ACTUAL
 * rendered CSS — not assumed from the substitution existing.
 *
 * Computed-value diffing can't see this class of failure: a substitution
 * that never made it into the stylesheet leaves the source's own literal in
 * place, which trivially equals the source and produces no difference to
 * classify at all. This is a separate, independent check for exactly that
 * blind spot — the same shape as assertTokensPresent, at the per-substitution
 * level instead of "does the page have --st- properties anywhere at all".
 */
// core.colors.overlay is exempt: a covered scrim is deliberately neutralized
// to `transparent` (neutralizeCoveredScrims) because the real value comes
// from a per-site color-mix() rule, not a var() — that mechanism has its own
// proof, the computed-style diff against source, not this check. See
// findUnrewritten's doc comment.
const EXEMPT_TOKENS = new Set(["core.colors.overlay"]);

export function checkTokenizationCoverage(
  renderedHtml: string,
  substitutions: Substitution[],
): UntokenizedSubstitution[] {
  const css = [...renderedHtml.matchAll(/<style>([\s\S]*?)<\/style>/g)]
    .map((m) => m[1])
    .join("\n");

  // The classify/rewrite agreement check itself lives in tokenize-css.ts,
  // next to the two functions it's checking — this just supplies the CSS a
  // real render produced instead of rewriteCss's direct output.
  return findUnrewritten(css, substitutions, EXEMPT_TOKENS).map((sub) => ({
    selector: sub.selector,
    property: sub.property,
    token: sub.token,
  }));
}

/**
 * Fail loudly when the rendered page declares no tokens.
 *
 * Every rewritten declaration is `var(--st-x, <source literal>)`. Without the
 * token block those fallbacks resolve to exactly what the source had, so the
 * diff comes back clean and means nothing. A silent pass here would be the
 * single most misleading result this pipeline can produce.
 */
function assertTokensPresent(html: string): void {
  if (!/--st-[a-z-]+\s*:/.test(html)) {
    throw new Error(
      "Rendered output declares no --st- custom properties. Every rewritten rule " +
      "would fall back to its source literal, making this comparison meaningless. " +
      "Check that renderSlotted emits the token block from resolveTheme.",
    );
  }
}

// ============================================================================
// TARGETS
// ============================================================================

/**
 * Which elements to compare.
 *
 * Derived from the substitution map rather than hardcoded: every selector we
 * tokenized is precisely where a mapping error would show, and a template that
 * tokenizes something unusual gets it checked for free.
 */
function buildTargets(
  substitutions: Substitution[],
  analysis: TemplateAnalysis,
  extra: Target[],
): Target[] {
  const seen = new Set<string>();
  const targets: Target[] = [];

  const add = (selector: string, pseudo?: "before" | "after") => {
    const key = `${selector}::${pseudo ?? ""}`;
    if (seen.has(key)) return;
    seen.add(key);
    targets.push({ selector, pseudo });
  };

  for (const sub of substitutions) {
    const match = sub.selector.match(/^(.*?)::?(before|after)$/);
    if (match) add(match[1].trim(), match[2] as "before" | "after");
    else add(sub.selector);
  }

  // Section roots carry the scrim and the background, and are where a
  // per-section override would land.
  for (const section of analysis.sections) {
    add(section.selector);
    add(section.selector, "before");
    add(section.selector, "after");
  }

  // Structural anchors. If `body` or `h1` differ, something broad is wrong and
  // the per-selector results are downstream noise.
  for (const selector of ["body", "header", "footer", "h1", "h2", "p", "a"]) add(selector);

  for (const target of extra) add(target.selector, target.pseudo);

  return targets;
}

// ============================================================================
// PROBE
// ============================================================================

interface Probed {
  key: string;
  selector: string;
  pseudo?: string;
  index: number;
  styles: Record<string, string>;
}

async function probe(
  browser: Awaited<ReturnType<typeof chromium.launch>>,
  html: string,
  targets: Target[],
): Promise<Map<string, Probed>> {
  const page: Page = await browser.newPage({ viewport: { width: 1280, height: 900 } });

  try {
    // `domcontentloaded`, not `networkidle`: linked stylesheets may 404 in a
    // detached document, and waiting for network quiet would hang. Inline CSS —
    // which is all we compare — applies immediately.
    await page.setContent(html, { waitUntil: "domcontentloaded" });

    const results = await page.evaluate(
      ({ targets, properties }) => {
        const out: Probed[] = [];

        for (const target of targets) {
          let elements: Element[];
          try {
            elements = Array.from(document.querySelectorAll(target.selector));
          } catch {
            continue; // A selector the browser rejects; reported as structural.
          }

          elements.forEach((el, index) => {
            const computed = getComputedStyle(
              el,
              target.pseudo ? `::${target.pseudo}` : undefined,
            );

            const styles: Record<string, string> = {};
            for (const property of properties) {
              styles[property] = computed.getPropertyValue(property);
            }

            out.push({
              key: `${target.selector}::${target.pseudo ?? ""}#${index}`,
              selector: target.selector,
              pseudo: target.pseudo,
              index,
              styles,
            });
          });
        }

        return out;
      },
      { targets, properties: PROPERTIES as unknown as string[] },
    );

    return new Map(results.map((r) => [r.key, r]));
  } finally {
    await page.close();
  }
}

// ============================================================================
// COMPARE
// ============================================================================

function compare(
  source: Map<string, Probed>,
  rendered: Map<string, Probed>,
  rules: ExpectedRule[],
  warnings: string[],
  targetCount: number,
  untokenized: UntokenizedSubstitution[],
): VerifyResult {
  const differences: Difference[] = [];
  const counts = new Map<string, { source: number; rendered: number }>();

  const bump = (map: Map<string, Probed>, field: "source" | "rendered") => {
    for (const probed of map.values()) {
      const key = `${probed.selector}::${probed.pseudo ?? ""}`;
      const entry = counts.get(key) ?? { source: 0, rendered: 0 };
      entry[field] += 1;
      counts.set(key, entry);
    }
  };

  bump(source, "source");
  bump(rendered, "rendered");

  const structural = [...counts.entries()]
    .filter(([, c]) => c.source !== c.rendered)
    .map(([selector, c]) => ({ selector, source: c.source, rendered: c.rendered }));

  for (const [key, sourceProbe] of source) {
    const renderedProbe = rendered.get(key);

    // Missing entirely — already reported as structural. Emitting a difference
    // per property as well would bury everything else.
    if (!renderedProbe) continue;

    for (const property of PROPERTIES) {
      const a = normalize(sourceProbe.styles[property]);
      const b = normalize(renderedProbe.styles[property]);
      if (a === b) continue;

      // Built before the rule match, not after: `when` needs the actual
      // values to distinguish "expected" causes from ones that only look
      // the same at the (property, selector) level. classification/reason
      // below are placeholders — overwritten once the rule (if any) is known.
      const candidate: Difference = {
        selector: sourceProbe.selector,
        pseudo: sourceProbe.pseudo,
        index: sourceProbe.index,
        property,
        source: sourceProbe.styles[property],
        rendered: renderedProbe.styles[property],
        classification: "unexpected",
      };

      const rule = rules.find(
        (r) => r.property.test(property) &&
               (!r.selector || r.selector.test(sourceProbe.selector)) &&
               (!r.when || r.when(candidate)),
      );

      differences.push({
        ...candidate,
        classification: rule ? "expected" : "unexpected",
        reason: rule?.reason,
      });
    }
  }

  if (structural.length > 0) {
    warnings.push(
      `${structural.length} selector(s) match a different number of elements. ` +
      `Normalization closes unclosed tags and assigns ids, so some of this is ` +
      `expected — but a large count means the tree changed materially.`,
    );
  }

  return {
    differences,
    structural,
    unexpected: differences.filter((d) => d.classification === "unexpected").length,
    warnings,
    targetCount,
    probeCount: source.size,
    untokenized,
  };
}

/**
 * Ignore formatting-only variation.
 *
 * Browsers normalise colours to `rgb()` and lengths to `px` on both sides, so
 * most of this is belt-and-braces — but quoted font stacks and zero-value
 * spellings do differ, and a diff full of `0px` vs `0` teaches people to skim.
 */
export function normalize(value: string | undefined): string {
  if (!value) return "";

  return value
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/["']/g, "")
    .replace(/\b0px\b/g, "0")
    // A computed background-color that traces back through color-mix() (the
    // scrim's per-site rule) serializes as CSS Color 4's `color(srgb …)`
    // rather than `rgb()`/`rgba()` — same colour, different function, and an
    // unnormalized diff reads it as a mapping bug. srgb's r/g/b are 0–1
    // fractions; rgb()'s are 0–255 integers.
    .replace(
      /color\(srgb ([\d.]+) ([\d.]+) ([\d.]+)(?: \/ ([\d.]+))?\)/g,
      (_, r: string, g: string, b: string, a?: string) => {
        const to255 = (fraction: string) => Math.round(Number(fraction) * 255);
        return a === undefined
          ? `rgb(${to255(r)}, ${to255(g)}, ${to255(b)})`
          : `rgba(${to255(r)}, ${to255(g)}, ${to255(b)}, ${Number(a)})`;
      },
    )
    .replace(/rgba\(([^)]+),\s*1\)/g, "rgb($1)");
}

// ============================================================================
// REPORT
// ============================================================================

export function formatVerification(result: VerifyResult): string {
  const lines: string[] = [];

  const unexpected = result.differences.filter((d) => d.classification === "unexpected");
  const expected = result.differences.filter((d) => d.classification === "expected");

  lines.push(
    `Compared ${result.probeCount} element(s) across ${result.targetCount} target selector(s)\n` +
    `${unexpected.length} unexpected, ${expected.length} expected, ` +
    `${result.structural.length} structural, ${result.untokenized.length} untokenized\n`,
  );

  if (result.untokenized.length > 0) {
    lines.push(
      "## Untokenized — mapped by tokenize-css but absent from the rendered CSS\n",
    );
    for (const u of result.untokenized) {
      lines.push(`  ${u.selector} { ${u.property} }  ->  ${u.token}`);
    }
    lines.push(
      "  Computed-style diffing can't see this: the source's own literal is still\n" +
      "  in place, which trivially equals the source and produces no difference.\n",
    );
  }

  if (unexpected.length > 0) {
    lines.push("## Unexpected — these are mapping bugs\n");
    for (const d of unexpected) {
      lines.push(
        `  ${label(d)}\n` +
        `    ${d.property}\n` +
        `      source:   ${d.source}\n` +
        `      rendered: ${d.rendered}`,
      );
    }
    lines.push("");
  }

  if (result.structural.length > 0) {
    lines.push("## Structural — element counts differ\n");
    for (const s of result.structural) {
      lines.push(`  ${s.selector.padEnd(40)} source ${s.source} → rendered ${s.rendered}`);
    }
    lines.push("");
  }

  // Grouped, because the same reason repeats across dozens of elements and a
  // flat list of them drowns the section above.
  if (expected.length > 0) {
    const byReason = new Map<string, number>();
    for (const d of expected) byReason.set(d.reason!, (byReason.get(d.reason!) ?? 0) + 1);

    lines.push("## Expected\n");
    for (const [reason, count] of byReason) lines.push(`  ${String(count).padStart(4)}  ${reason}`);
    lines.push("");
  }

  for (const warning of result.warnings) lines.push(`! ${warning}`);

  return lines.join("\n");
}

const label = (d: Difference): string =>
  `${d.selector}${d.pseudo ? `::${d.pseudo}` : ""}${d.index > 0 ? ` [${d.index}]` : ""}`;