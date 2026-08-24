// ============================================================================
// tools/template-import/css/tokenize-css.ts
//
// The CSS half of the import. One walk, two artifacts:
//
//   substitutions  selector+property -> token path, used to rewrite the
//                  stylesheet so a slotted template gains palette control
//   theme draft    the resolved values, used as a preset's LayeredTheme
//
// Substitutions are keyed on SELECTOR + PROPERTY, never on literal value. In a
// typical source `#fff` appears as body{color}, nav a{color}, .bar{background},
// .btn{border} and .btn{background} — five declarations, four different tokens.
// A value-keyed map collapses them, and the first customer who darkens their
// body text gets an invisible button.
//
// Build-time only. The renderer serves the already-rewritten stylesheet and
// never learns which literal became which token.
// ============================================================================

import * as csstree from "css-tree";
import { HeadingUsage } from "../analyze";

// ============================================================================
// TYPES
// ============================================================================

export interface Substitution {
  /** Normalized selector text, including any pseudo-element. */
  selector: string;
  property: string;
  /** Dotted path into LayeredTheme, e.g. "core.colors.primary". */
  token: string;
  /** Media prelude when the declaration sits inside one. */
  media?: string;
  /** Kept for the render-and-diff step. */
  original: string;
  confidence: number;
  note?: string;
}

export interface UnmappedDeclaration {
  selector: string;
  property: string;
  value: string;
  media?: string;
  /** Why it was skipped: structural, or a genuine gap in the rule table. */
  reason: "structural" | "unrecognised";
}

export interface AssetRef {
  /** Selector the background belongs to, pseudo-element included. */
  selector: string;
  url: string;
}

export interface TypeScaleFit {
  baseFontSize: string;
  scaleRatio: number;
  /** Per-heading percentage error against the source's authored size. */
  residuals: Array<{ tag: string; authored: number; fitted: number; errorPct: number }>;
  excluded: string[];
  note?: string;
}

export interface TokenizeResult {
  substitutions: Substitution[];
  unmapped: UnmappedDeclaration[];
  assets: AssetRef[];
  /** Partial LayeredTheme. Not parsed — see buildThemeDraft. */
  theme: Record<string, unknown>;
  typeScale?: TypeScaleFit;
  /** Things a reviewer needs to see that aren't substitutions. */
  findings: string[];
}

export interface TokenizeOptions {
  /**
   * How many times each heading tag appears in the MARKUP, from the analyze
   * pass. A tag used once is usually not part of the type scale — in the
   * reference template `h3` appears only as a button label, and including it
   * throws the fit off by 24%.
   */
  headingUsage?: Record<string, HeadingUsage>;
  /** Origins permitted in @import and url(). Empty means same-origin only. */
  allowedOrigins?: string[];
}

// ============================================================================
// RULE TABLE
// ============================================================================

/**
 * selector + property -> token.
 *
 * `selector` is matched against normalized selector text. A string is an exact
 * match; a RegExp is tested. Order matters — first match wins, so put specific
 * selectors above generic element ones.
 */
interface TokenRule {
  selector: string | RegExp;
  property: string;
  token: string;
  confidence: number;
  note?: string;
}

const RULES: TokenRule[] = [
  // ---- page ----
  { selector: "body", property: "background-color", token: "core.colors.background", confidence: 0.95 },
  { selector: "body", property: "color", token: "core.colors.text", confidence: 0.95 },
  { selector: "body", property: "font-family", token: "core.typography.fontFamilyBase", confidence: 0.95 },

  // ---- header ----
  { selector: /^header$/, property: "background-color", token: "semantic.navBackground", confidence: 0.9 },
  { selector: /^header$/, property: "backdrop-filter", token: "templates.$.headerBlur", confidence: 0.7,
    note: "Template-scoped (Tier 3) — not every template has a translucent header." },
  { selector: /^(nav a|\.nav-links a)$/, property: "color", token: "semantic.navForeground", confidence: 0.9 },
  { selector: /\.nav-links$/, property: "background-color", token: "semantic.mobileMenuBackground", confidence: 0.85,
    note: "Only correct if this rule is inside the mobile media query." },

  // ---- sections ----
  { selector: /(^|,)\s*\.(hero|section)\b/, property: "padding-block", token: "core.spacing.sectionPaddingBlock", confidence: 0.85 },
  { selector: /(^|,)\s*\.(hero|section)\b/, property: "padding-inline", token: "core.spacing.sectionPaddingInline", confidence: 0.85 },
  { selector: /(^|,)\s*\.(hero|section)\b/, property: "min-height", token: "templates.$.sectionMinHeight", confidence: 0.6 },
  { selector: /::after$/, property: "background-color", token: "core.colors.overlay", confidence: 0.8,
    note: "Scrim. The alpha becomes overlayOpacity per section; the colour is the token." },
  { selector: /\.content$/, property: "max-width", token: "core.spacing.contentMaxInline", confidence: 0.9 },

  // ---- type ----
  { selector: /^p$/, property: "color", token: "core.colors.textMuted", confidence: 0.9,
    note: "A colour on the bare p selector overrides themed body text everywhere." },
  { selector: /^p$/, property: "font-size", token: "core.typography.baseFontSize", confidence: 0.85 },
  { selector: /^p$/, property: "line-height", token: "core.typography.lineHeightBase", confidence: 0.9 },
  { selector: /^h[1-6]$/, property: "line-height", token: "core.typography.lineHeightHeading", confidence: 0.85 },
  { selector: /^h[1-6]$/, property: "text-transform", token: "core.typography.headingTransform", confidence: 0.85 },
  { selector: /\.kicker$/, property: "text-transform", token: "core.typography.kickerTransform", confidence: 0.9 },
  { selector: /\.(kicker|logo)$/, property: "letter-spacing", token: "core.typography.letterSpacingWide", confidence: 0.6,
    note: "Sources often use several arbitrary values here; they collapse to one token." },

  // ---- buttons ----
  { selector: /\.btn$/, property: "background-color", token: "core.colors.primary", confidence: 0.9 },
  { selector: /\.btn$/, property: "color", token: "core.colors.onPrimary", confidence: 0.9 },
  { selector: /\.btn$/, property: "border-color", token: "core.colors.primary", confidence: 0.75 },
  { selector: /\.btn$/, property: "border-radius", token: "core.spacing.radius", confidence: 0.9 },
  { selector: /\.btn$/, property: "text-transform", token: "core.button.textTransform", confidence: 0.85 },
  { selector: /\.btn$/, property: "transition", token: "core.motion.speed", confidence: 0.7,
    note: "Only the duration is tokenized; the easing is a separate token." },
  { selector: /\.btn:hover$/, property: "background-color", token: "core.colors.primaryHover", confidence: 0.8 },

  // ---- footer ----
  { selector: /^footer$/, property: "background-color", token: "semantic.footerBackground", confidence: 0.9 },
  { selector: /^footer$/, property: "border-top-color", token: "semantic.footerBorder", confidence: 0.9 },
  { selector: /^footer p$/, property: "color", token: "semantic.footerForeground", confidence: 0.9 },
];

/**
 * Properties that describe layout rather than appearance. Skipped as
 * "structural" rather than reported as gaps, so the unmapped list stays a
 * genuine to-do rather than noise.
 */
const STRUCTURAL = new Set([
  "display", "position", "top", "right", "bottom", "left", "inset", "z-index",
  "flex", "flex-direction", "flex-wrap", "justify-content", "align-items",
  "gap", "grid", "grid-template-columns", "overflow", "box-sizing", "content",
  "width", "height", "margin", "margin-bottom", "margin-left", "cursor",
  "list-style", "text-decoration", "text-align", "scroll-behavior",
  "background-size", "background-position", "border", "padding",
]);

/**
 * Tokens whose value legitimately comes from inside a media query. Everything
 * else, media-scoped, describes a breakpoint override that has no token — and
 * writing it to the desktop token silently replaces the desktop value.
 *
 * Exported so buildThemeDraft (this file) and rebuildTheme (pipeline.ts,
 * the retoken-override path) share one set rather than two independently
 * maintained copies — the same shape the classify/rewrite property mismatch
 * was, just for a filter instead of a lookup.
 */
export const MOBILE_SCOPED = new Set(["semantic.mobileMenuBackground"]);

// ============================================================================
// ENTRY POINT
// ============================================================================

export function tokenizeCss(css: string, options: TokenizeOptions = {}): TokenizeResult {
  const ast = csstree.parse(css, { positions: false });

  const substitutions: Substitution[] = [];
  const unmapped: UnmappedDeclaration[] = [];
  const assets: AssetRef[] = [];
  const findings: string[] = [];

  /** font-size per heading, collected rather than tokenized individually. */
  const headingSizes = new Map<string, number>();
  const mobileHeadingSizes = new Map<string, number>();
  let baseFontSize: number | undefined;
  let mobileBaseFontSize: number | undefined;
  let breakpointMd: string | undefined;

  const seenDeclarations = new Map<string, number>();

  csstree.walk(ast, {
    visit: "Rule",
    enter(rule: csstree.Rule) {
      const media = enclosingMedia(this.atrule);
      const isMobile = Boolean(media && /max-width/.test(media));

      if (media && !breakpointMd) {
        const width = media.match(/max-width\s*:\s*([\d.]+px)/)?.[1];
        if (width) breakpointMd = width;
      }

      for (const selector of selectorsOf(rule)) {
        for (const decl of declarationsOf(rule)) {
            for (const { property, value } of expand(decl).parts) {

            // Keyed on selector + media + property. Keying on selector alone counts
            // a desktop rule and its mobile override as a duplicate, which is just
            // ordinary responsive CSS — on the reference template that produced eight
            // false findings out of twelve.
            const declKey = `${selector}|${media ?? ""}|${property}`;
            seenDeclarations.set(declKey, (seenDeclarations.get(declKey) ?? 0) + 1);
            // --- background images are assets, not tokens ---
            const url = property === "background-image"
              ? value.match(/url\(\s*['"]?([^'")]+)/)?.[1]
              : undefined;

            if (url) {
              assets.push({ selector, url });
              continue;
            }

            // --- heading sizes feed the scale fit, not per-tag tokens ---
            if (/^h[1-6]$/.test(selector) && property === "font-size") {
              (isMobile ? mobileHeadingSizes : headingSizes).set(selector, px(value));
              continue;
            }
            if (selector === "p" && property === "font-size") {
              if (isMobile) mobileBaseFontSize = px(value);
              else baseFontSize = px(value);
            }

            if (STRUCTURAL.has(property)) {
              unmapped.push({ selector, property, value, media, reason: "structural" });
              continue;
            }

            const rule_ = RULES.find(
              (r) => r.property === property && matches(r.selector, selector),
            );

            if (!rule_) {
              unmapped.push({ selector, property, value, media, reason: "unrecognised" });
              continue;
            }

            substitutions.push({
              selector,
              property,
              token: rule_.token,
              media,
              original: value,
              confidence: rule_.confidence,
              note: rule_.note,
            });
          }
        }
      }
    },
  });

  // --- findings that aren't substitutions ------------------------------------

  findings.push(...checkImports(ast, options.allowedOrigins ?? []));
  findings.push(...checkNoOpHover(substitutions));
  findings.push(...checkMissingFonts(substitutions, ast));
  findings.push(...detectTokenCollisions(substitutions));

  for (const [key, count] of seenDeclarations) {
    if (count === 1) continue;

    const [selector, media, property] = key.split("|");
    findings.push(
        `${selector}${media ? ` @media ${media}` : ""} declares "${property}" ` +
        `${count} times — the earlier one is dead.`,
    );
  }

  const typeScale = fitTypeScale(headingSizes, baseFontSize ?? 16, options.headingUsage);
  const mobileScale = fitTypeScale(mobileHeadingSizes, mobileBaseFontSize ?? 16, options.headingUsage);

  return {
    substitutions,
    unmapped,
    assets,
    theme: buildThemeDraft(substitutions, typeScale, mobileScale, breakpointMd),
    typeScale,
    findings,
  };
}



// ============================================================================
// TYPE SCALE
// ============================================================================

/**
 * Solve for the ratio that best reproduces the source's heading sizes, where
 * h6 = base and h1 = base * ratio^5.
 *
 * Least squares through the origin on log sizes. Residuals are reported rather
 * than silently absorbed: a source whose headings were hand-nudged will not fit
 * any ratio, and that's a decision for a human — reproduce the original exactly
 * with three magic numbers, or be internally consistent and accept a visible
 * difference.
 */
function fitTypeScale(
  sizes: Map<string, number>,
  base: number,
  usage?: Record<string, HeadingUsage>,
): TypeScaleFit | undefined {
  if (sizes.size === 0) return undefined;

  // A heading tag used once in the markup is usually not a heading — in the
  // reference template h3 is a button label. Excluding it moves the fit error
  // from ~24% to ~1.5%.
  const excluded: string[] = [];
  const entries = [...sizes.entries()].filter(([tag]) => {
    if (usage && (usage[tag]?.structural ?? 1) === 0) {
      excluded.push(tag);
      return false;
    }
  return true;
});

  if (entries.length === 0) return undefined;

  let numerator = 0;
  let denominator = 0;

  for (const [tag, size] of entries) {
    const step = 6 - Number(tag[1]);          // h1 -> 5 ... h6 -> 0
    numerator += step * Math.log(size / base);
    denominator += step * step;
  }

  const ratio = denominator === 0 ? 1.25 : Math.exp(numerator / denominator);

  const residuals = [...sizes.entries()].map(([tag, authored]) => {
    const fitted = base * ratio ** (6 - Number(tag[1]));
    return {
      tag,
      authored,
      fitted: Number(fitted.toFixed(1)),
      errorPct: Number((((fitted - authored) / authored) * 100).toFixed(1)),
    };
  });

  const worst = Math.max(...residuals.map((r) => Math.abs(r.errorPct)));

  return {
    baseFontSize: `${base}px`,
    scaleRatio: Number(ratio.toFixed(4)),
    residuals,
    excluded,
    note: worst > 10
      ? `Worst fit is ${worst}% off — the source's headings are not on a consistent scale. Decide whether to match it or be consistent.`
      : undefined,
  };
}

// ============================================================================
// THEME DRAFT
// ============================================================================

/**
 * Fold substitutions into a partial LayeredTheme.
 *
 * Not parsed against LayeredThemeSchema: core requires colours the source may
 * never declare (success/warning/error), and failing here would hide the 80%
 * that did extract. The authoring script fills gaps and parses.
 *
 * Later substitutions overwrite earlier ones for the same token, which is
 * correct — later rules win in the cascade too.
 */
function buildThemeDraft(
  substitutions: Substitution[],
  typeScale?: TypeScaleFit,
  mobileScale?: TypeScaleFit,
  breakpointMd?: string,
): Record<string, unknown> {
  const draft: Record<string, unknown> = {};

    for (const sub of substitutions) {
    if (sub.media && !MOBILE_SCOPED.has(sub.token)) continue;
    setPath(draft, sub.token, normalizeValue(sub.token, sub.property, sub.original));
    }

  if (typeScale) {
    setPath(draft, "core.typography.baseFontSize", typeScale.baseFontSize);
    setPath(draft, "core.typography.scaleRatio", typeScale.scaleRatio);
  }
  if (mobileScale) {
    setPath(draft, "core.typography.scaleRatioMobile", mobileScale.scaleRatio);
  }
  if (breakpointMd) {
    setPath(draft, "core.breakpoints.md", breakpointMd);
  }

  return draft;
}

/**
 * Two or more substitutions writing the SAME token with DIFFERING values.
 * buildThemeDraft's (and rebuildTheme's, in pipeline.ts) last-write-wins loop
 * resolves this silently, by stylesheet order — which is arbitrary. This is
 * how the h1/h2 lineHeightHeading collapse (source authored 1.05 and 1.1)
 * stayed invisible: whichever declaration happened to come last in source
 * order won, and nothing said so.
 *
 * Filtered the same way buildThemeDraft's loop is (media-scoped, non-
 * MOBILE_SCOPED substitutions never get written at all) — otherwise this
 * would flag pairs that were never actually competing for the token.
 *
 * A collapse isn't inherently wrong — three arbitrary letter-spacing values
 * legitimately reducing to one token is fine, sources do this constantly —
 * the point is making the collapse visible for a reviewer to accept or
 * reject, not deciding it silently by rule order.
 */
export function detectTokenCollisions(substitutions: Substitution[]): string[] {
  const applicable = substitutions.filter((sub) => !sub.media || MOBILE_SCOPED.has(sub.token));

  const byToken = new Map<string, Substitution[]>();
  for (const sub of applicable) {
    const list = byToken.get(sub.token) ?? [];
    list.push(sub);
    byToken.set(sub.token, list);
  }

  const findings: string[] = [];

  for (const [token, subs] of byToken) {
    const distinctValues = new Set(subs.map((s) => s.original.trim()));
    if (distinctValues.size <= 1) continue;

    // Order matches buildThemeDraft's iteration order (substitutions, as
    // classified) — the last one in that order is the one setPath leaves
    // standing.
    const winner = subs[subs.length - 1];
    const competitors = subs
      .map((s) => `${s.selector} { ${s.property}: ${s.original} }`)
      .join(", ");

    findings.push(
      `${token} is written by ${subs.length} declarations with different values ` +
      `— ${competitors}. Resolution is stylesheet order, not intent: ` +
      `"${winner.original}" (${winner.selector}) was kept, the rest were discarded.`,
    );
  }

  return findings;
}

/**
 * Tokens the schema types as numbers. CSS values are always strings, so
 * anything landing in one of these needs coercion or LayeredThemeSchema.parse()
 * throws at authoring time — several stages after the extraction that caused it.
 *
 * Keyed on TOKEN, not property: `core.spacing.radius` is a string "0px" while
 * `core.typography.lineHeightBase` is a number, and nothing about the property
 * name distinguishes them.
 */
const NUMERIC_TOKENS = new Set([
  "core.typography.lineHeightBase",
  "core.typography.lineHeightHeading",
  "core.typography.scaleRatio",
  "core.typography.scaleRatioMobile",
  "core.typography.fontWeightNormal",
  "core.typography.fontWeightMedium",
  "core.typography.fontWeightBold",
]);

export function normalizeValue(token: string, property: string, value: string): string | number {
  if (property === "transition") {
    return value.match(/([\d.]+m?s)/)?.[1] ?? value;
  }

  if (NUMERIC_TOKENS.has(token)) {
    const n = Number.parseFloat(value);
    // `line-height: normal` and `font-weight: bold` are valid CSS with no
    // numeric form. Returning the string lets the schema reject it with a
    // useful path rather than writing NaN into the theme.
    return Number.isFinite(n) ? n : value;
  }

  return value.trim();
}

// ============================================================================
// FINDINGS
// ============================================================================

function checkImports(ast: csstree.CssNode, allowedOrigins: string[]): string[] {
  const found: string[] = [];

  csstree.walk(ast, {
    visit: "Atrule",
    enter(node: csstree.Atrule) {
      if (node.name !== "import") return;

      const raw = csstree.generate(node.prelude ?? ({} as csstree.CssNode));
      const url = raw.match(/url\(\s*['"]?([^'")]+)/)?.[1] ?? raw.replace(/['"]/g, "");

      if (!/^https?:/i.test(url)) return;

      const host = safeHost(url);
      if (host && !allowedOrigins.some((o) => host.endsWith(o))) {
        found.push(
          `@import from a disallowed origin: ${url} — strip it, or add the origin to sanitize.allowedOrigins.`,
        );
      }
    },
  });

  return found;
}

/** A hover state identical to its base state does nothing and should not be authored. */
function checkNoOpHover(substitutions: Substitution[]): string[] {
  const findings: string[] = [];

  for (const hover of substitutions.filter((s) => s.selector.includes(":hover"))) {
    const base = substitutions.find(
      (s) => s.selector === hover.selector.replace(/:hover/, "") && s.property === hover.property,
    );

    if (base && sameColor(base.original, hover.original)) {
      findings.push(
        `${hover.selector} { ${hover.property} } is identical to its base state — ` +
        `leave the hover token unset and let resolveTheme derive it.`,
      );
    }
  }

  return findings;
}

/** A font-family the page never loads has been silently falling back. */
function checkMissingFonts(substitutions: Substitution[], ast: csstree.CssNode): string[] {
  const declared = substitutions.find((s) => s.property === "font-family");
  if (!declared) return [];

  const first = declared.original.split(",")[0].replace(/['"]/g, "").trim();

  let loaded = false;
  csstree.walk(ast, {
    visit: "Atrule",
    enter(node: csstree.Atrule) {
      if (node.name !== "font-face" && node.name !== "import") return;
      if (csstree.generate(node).includes(first)) loaded = true;
    },
  });

  return loaded
    ? []
    : [`Font "${first}" is used but never loaded — every render has been falling back. Decide what the preset declares.`];
}

// ============================================================================
// REWRITE
// ============================================================================

/**
 * Apply the substitutions, producing the stylesheet that actually ships.
 *
 * `tokenToVar` must agree exactly with the emission in resolveTheme; import it
 * from the renderer rather than reimplementing, or a rename silently produces
 * CSS referencing variables nothing declares.
 *
 * classify() (tokenizeCss, above) keys substitutions by the property `expand()`
 * produces, which for a shorthand is the LONGHAND (`background: #000` becomes
 * a substitution under `background-color`). This walk looks declarations up by
 * that same expansion, or a substitution built from shorthand silently never
 * matches — the bug findUnrewritten below exists to catch.
 *
 * Rewriting the shorthand declaration itself would mean splicing a var() into
 * one slot of a multi-part value (`background: url(x) center/cover no-repeat`)
 * without disturbing the rest — fragile, and wrong the moment a source pairs a
 * color with anything expand() doesn't also capture. So this only ever
 * replaces a declaration outright when `expand()` accounts for the ENTIRE
 * value (`complete`): then it's safe to drop the shorthand and emit the
 * longhand(s) instead, each var()-wrapped where a substitution exists and left
 * as its literal otherwise. Anything incomplete (`border: 2px solid #fff` —
 * expand only ever captures the color) is left untouched; the substitution
 * stays classified but unapplied, and findUnrewritten / verify's untokenized
 * gate is what surfaces that rather than this function pretending otherwise.
 */
export function rewriteCss(
  css: string,
  substitutions: Substitution[],
  tokenToVar: (token: string) => string,
): string {
  const ast = csstree.parse(css);
  const index = new Map(
    substitutions.map((s) => [`${s.selector}|${s.property}`, s]),
  );

  csstree.walk(ast, {
    visit: "Rule",
    enter(rule: csstree.Rule) {
      for (const selector of selectorsOf(rule)) {
        csstree.walk(rule.block, {
          visit: "Declaration",
          enter(decl: csstree.Declaration, item, list) {
            const raw = { property: decl.property, value: csstree.generate(decl.value).trim() };
            const { parts, complete } = expand(raw);

            // Not a shorthand expand() recognises — same single-property
            // lookup as before expand() existed.
            if (parts.length === 1 && parts[0].property === decl.property) {
              const sub = index.get(`${selector}|${decl.property}`);
              if (!sub) return;

              decl.value = csstree.parse(`var(${tokenToVar(sub.token)}, ${sub.original})`, {
                context: "value",
              }) as csstree.Value;
              return;
            }

            if (!complete) return;

            const subs = parts.map((p) => index.get(`${selector}|${p.property}`));
            if (subs.every((s) => s === undefined)) return;

            const declText = parts
              .map((p, i) => {
                const sub = subs[i];
                const value = sub ? `var(${tokenToVar(sub.token)}, ${sub.original})` : p.value;
                return `${p.property}: ${value}`;
              })
              .join("; ");

            const replacement = (
              csstree.parse(declText, { context: "declarationList" }) as csstree.DeclarationList
            ).children;

            list.replace(item, replacement);
          },
        });
      }
    },
  });

  return csstree.generate(ast);
}

/**
 * Substitutions classify() produced that `rewritten` doesn't actually apply —
 * declared where classify (expand + RULES) and rewrite (rewriteCss, above)
 * both live, so the two are checked against each other directly rather than
 * only discovered downstream by rendering the page and diffing computed
 * styles (verify.ts's checkTokenizationCoverage, which delegates here after
 * pulling the <style> blocks out of a rendered document).
 *
 * A non-empty result is not automatically a bug: a shorthand expand() can't
 * fully account for (`border: 2px solid #fff` — width and style have nowhere
 * to go) is correctly classified but deliberately left unrewritten by design,
 * see rewriteCss's comment. This function doesn't distinguish that case from
 * a genuine regression — it reports disagreement; the caller (verify's
 * untokenized gate) decides whether disagreement here is acceptable.
 *
 * `exemptTokens` covers the OTHER deliberate case: a covered scrim
 * (core.colors.overlay) is neutralized to `transparent` on purpose — see
 * neutralizeCoveredScrims — because the real value comes from a per-site
 * color-mix() rule (slotted/index.ts's computeCssScrimRules), not a var().
 * That mechanism has its own, separate proof (the computed-style diff
 * against source), so a substitution whose token is exempt here isn't
 * unchecked — it's checked somewhere else, the same way a covered
 * background-image is validated by backgroundIdentityRule rather than by
 * this function.
 */
export function findUnrewritten(
  rewritten: string,
  substitutions: Substitution[],
  exemptTokens: ReadonlySet<string> = new Set(),
): Substitution[] {
  const declared = new Map<string, string>();

  csstree.walk(csstree.parse(rewritten), {
    visit: "Rule",
    enter(rule: csstree.Rule) {
      for (const selector of selectorsOf(rule)) {
        csstree.walk(rule.block, {
          visit: "Declaration",
          enter(decl: csstree.Declaration) {
            declared.set(`${selector}|${decl.property}`, csstree.generate(decl.value));
          },
        });
      }
    },
  });

  return substitutions.filter((sub) => {
    if (exemptTokens.has(sub.token)) return false;

    const value = declared.get(`${sub.selector}|${sub.property}`);
    return !value?.includes("var(--st-");
  });
}

/**
 * Replace `background-image` with `none` for every selector whose background
 * is now covered by a per-site cssBackgrounds rule.
 *
 * SOURCE_CSS's own url() was never actually winning — the per-site rule
 * already outranks it (same specificity, later in source order, see
 * slotted/index.ts's "8.5. Styles" comment) — so this doesn't change what
 * renders. It stops shipping a literal that only worked by accident of
 * cascade order and would silently reappear the moment the override didn't
 * land where expected.
 *
 * `covered` must be keyed identically to what classify() put in `AssetRef.selector`
 * — the FULL selector text including any pseudo (".starship::before"), from
 * the same selectorsOf() both passes share. A bare-selector key matches
 * nothing here and this becomes a silent no-op.
 *
 * Orphan backgrounds (no section match) must never appear in `covered` —
 * they're path-preserved into bundleAssets and still need their literal
 * url() to resolve. Callers should build `covered` from cssBackgrounds
 * specifically (which excludes orphans by construction), not from every
 * asset minus orphans.
 */
export function neutralizeCoveredBackgrounds(css: string, covered: Set<string>): string {
  if (covered.size === 0) return css;

  const ast = csstree.parse(css);

  csstree.walk(ast, {
    visit: "Rule",
    enter(rule: csstree.Rule) {
      for (const selector of selectorsOf(rule)) {
        if (!covered.has(selector)) continue;

        csstree.walk(rule.block, {
          visit: "Declaration",
          enter(decl: csstree.Declaration) {
            if (decl.property !== "background-image") return;

            decl.value = csstree.parse("none", { context: "value" }) as csstree.Value;
          },
        });
      }
    },
  });

  return csstree.generate(ast);
}

/**
 * Replace `background-color` with `transparent` for every scrim selector now
 * covered by a per-site cssScrims rule (see slotted/index.ts's
 * computeCssScrimRules) — the same "dead weight" argument as
 * neutralizeCoveredBackgrounds, for the same reason: rewriteCss's var()
 * substitution for a scrim resolves to a flat, alpha-less colour
 * (core.colors.overlay carries no opacity — see splitScrim in merge.ts), so
 * once the per-site color-mix() rule is authoritative for a selector, the
 * rewritten declaration underneath it is not just redundant but WRONG if
 * anything ever reads it directly (a browser dev tool, a screenshot diff
 * against the tokenized declaration instead of the cascade's winner).
 *
 * `transparent`, not `none` — background-color has no `none` keyword in its
 * grammar; unlike background-image, "empty" here means the colour underneath
 * shows through unmodified, which for a covered scrim is exactly the source
 * document's own background, correct until the per-site rule paints over it.
 *
 * Orphan scrims (no section match, so no cssScrims entry) must never appear
 * in `covered` — same reasoning as orphan backgrounds, though slotted has no
 * fallback story for one yet: an orphan scrim's alpha was never captured by
 * splitScrim (nothing to attach it to), so rewriteCss's var() substitution
 * is the only rendering it gets, flat colour and all.
 */
export function neutralizeCoveredScrims(css: string, covered: Set<string>): string {
  if (covered.size === 0) return css;

  const ast = csstree.parse(css);

  csstree.walk(ast, {
    visit: "Rule",
    enter(rule: csstree.Rule) {
      for (const selector of selectorsOf(rule)) {
        if (!covered.has(selector)) continue;

        csstree.walk(rule.block, {
          visit: "Declaration",
          enter(decl: csstree.Declaration) {
            if (decl.property !== "background-color") return;

            decl.value = csstree.parse("transparent", { context: "value" }) as csstree.Value;
          },
        });
      }
    },
  });

  return csstree.generate(ast);
}

// ============================================================================
// HELPERS
// ============================================================================

// Exported so verify.ts's tokenization-coverage check walks CSS with the
// identical selector normalization the classify pass and rewriteCss already
// share — a second implementation could disagree on formatting and silently
// stop matching, the same class of bug pathFor() had.
export function selectorsOf(rule: csstree.Rule): string[] {
  return csstree
    .generate(rule.prelude)
    .split(",")
    .map((s) => s.replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

function declarationsOf(rule: csstree.Rule): Array<{ property: string; value: string }> {
  const out: Array<{ property: string; value: string }> = [];

  csstree.walk(rule.block, {
    visit: "Declaration",
    enter(decl: csstree.Declaration) {
      out.push({ property: decl.property, value: csstree.generate(decl.value).trim() });
    },
  });

  return out;
}

interface ExpandedPart {
  property: string;
  value: string;
}

interface ExpandResult {
  parts: ExpandedPart[];
  /**
   * Whether `parts` accounts for the entire source value, with nothing left
   * over. Only when this is true is it safe for rewriteCss to drop the
   * shorthand and emit `parts` as standalone longhands — otherwise whatever
   * expand() didn't capture (a border's width and style, a background's
   * position/size/repeat...) would be silently discarded.
   */
  complete: boolean;
}

/**
 * Minimal shorthand expansion — only the longhands the rule table names.
 *
 * `background: #000` must become `background-color` or the body rule never
 * matches; `border-top: 1px solid #222` must yield `border-top-color` or the
 * footer divider is missed.
 */
function expand(decl: { property: string; value: string }): ExpandResult {
  const { property, value } = decl;

  if (property === "background") {
    const colorMatch = value.match(/(#[0-9a-f]{3,8}|rgba?\([^)]+\)|hsla?\([^)]+\)|\b(?:transparent|white|black)\b)/i);
    const urlMatch = value.match(/url\([^)]+\)/);
    const parts: ExpandedPart[] = [
      ...(colorMatch ? [{ property: "background-color", value: colorMatch[1] }] : []),
      ...(urlMatch ? [{ property: "background-image", value: urlMatch[0] }] : []),
    ];
    if (parts.length === 0) return { parts: [decl], complete: false };

    const leftover = [colorMatch?.[0], urlMatch?.[0]]
      .filter((m): m is string => Boolean(m))
      .reduce((v, m) => v.replace(m, ""), value)
      .trim();
    return { parts, complete: leftover.length === 0 };
  }

  if (/^border(-top|-right|-bottom|-left)?$/.test(property)) {
    const colorMatch = value.match(/(#[0-9a-f]{3,8}|rgba?\([^)]+\)|\b(?:transparent|white|black)\b)/i);
    if (!colorMatch) return { parts: [decl], complete: false };

    const leftover = value.replace(colorMatch[0], "").trim();
    return {
      parts: [{ property: `${property}-color`, value: colorMatch[1] }],
      complete: leftover.length === 0,
    };
  }

  if (property === "padding" || property === "margin") {
    const parts = value.split(/\s+/);
    if (parts.length === 2) {
      // A 2-value shorthand IS exactly its two longhands (top/bottom,
      // left/right) — nothing is left over by construction.
      return {
        parts: [
          { property: `${property}-block`, value: parts[0] },
          { property: `${property}-inline`, value: parts[1] },
        ],
        complete: true,
      };
    }
  }

  // Not a shorthand this function decomposes — already at whatever property
  // name it's going to be looked up under, so "complete" is moot.
  return { parts: [decl], complete: true };
}

const matches = (pattern: string | RegExp, selector: string): boolean =>
  typeof pattern === "string" ? pattern === selector : pattern.test(selector);

function enclosingMedia(atrule: csstree.Atrule | null): string | undefined {
  if (!atrule || atrule.name !== "media") return undefined;
  return csstree.generate(atrule.prelude ?? ({} as csstree.CssNode)).trim();
}

const px = (value: string): number => Number.parseFloat(value);

function sameColor(a: string, b: string): boolean {
  const norm = (v: string) =>
    v.trim().toLowerCase().replace(/\s+/g, "")
      .replace(/^white$/, "#ffffff").replace(/^black$/, "#000000")
      .replace(/^#([0-9a-f])([0-9a-f])([0-9a-f])$/, "#$1$1$2$2$3$3");
  return norm(a) === norm(b);
}

function safeHost(url: string): string | null {
  try { return new URL(url).host; } catch { return null; }
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