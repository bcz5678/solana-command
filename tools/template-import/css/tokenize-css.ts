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
  headingUsage?: Record<string, number>;
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

  const seenSelectors = new Map<string, number>();

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
        seenSelectors.set(selector, (seenSelectors.get(selector) ?? 0) + 1);

        for (const decl of declarationsOf(rule)) {
          for (const { property, value } of expand(decl)) {
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

  for (const [selector, count] of seenSelectors) {
    if (count > 1) {
      findings.push(`"${selector}" is declared ${count} times — later rules may be dead or contradictory.`);
    }
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
  usage?: Record<string, number>,
): TypeScaleFit | undefined {
  if (sizes.size === 0) return undefined;

  // A heading tag used once in the markup is usually not a heading — in the
  // reference template h3 is a button label. Excluding it moves the fit error
  // from ~24% to ~1.5%.
  const excluded: string[] = [];
  const entries = [...sizes.entries()].filter(([tag]) => {
    if (usage && (usage[tag] ?? 0) === 1) { excluded.push(tag); return false; }
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
    // Tier 3 paths carry a `$` placeholder for the template id; the authoring
    // script substitutes it once the template is named.
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
          enter(decl: csstree.Declaration) {
            const sub = index.get(`${selector}|${decl.property}`);
            if (!sub) return;

            decl.value = csstree.parse(`var(${tokenToVar(sub.token)}, ${sub.original})`, {
              context: "value",
            }) as csstree.Value;
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

function selectorsOf(rule: csstree.Rule): string[] {
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

/**
 * Minimal shorthand expansion — only the longhands the rule table names.
 *
 * `background: #000` must become `background-color` or the body rule never
 * matches; `border-top: 1px solid #222` must yield `border-top-color` or the
 * footer divider is missed.
 */
function expand(decl: { property: string; value: string }): Array<{ property: string; value: string }> {
  const { property, value } = decl;

  if (property === "background") {
    const color = value.match(/(#[0-9a-f]{3,8}|rgba?\([^)]+\)|hsla?\([^)]+\)|\b(?:transparent|white|black)\b)/i)?.[1];
    const url = value.match(/url\([^)]+\)/)?.[0];
    return [
      ...(color ? [{ property: "background-color", value: color }] : []),
      ...(url ? [{ property: "background-image", value: url }] : []),
    ];
  }

  if (/^border(-top|-right|-bottom|-left)?$/.test(property)) {
    const color = value.match(/(#[0-9a-f]{3,8}|rgba?\([^)]+\)|\b(?:transparent|white|black)\b)/i)?.[1];
    return color ? [{ property: `${property}-color`, value: color }] : [];
  }

  if (property === "padding" || property === "margin") {
    const parts = value.split(/\s+/);
    if (parts.length === 2) {
      return [
        { property: `${property}-block`, value: parts[0] },
        { property: `${property}-inline`, value: parts[1] },
      ];
    }
  }

  return [decl];
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