// ============================================================================
// packages/site-renderer/src/theme.ts
//
// Three-tier token resolution, then flattening to CSS custom properties.
//
//   Tier 1 CORE      — universal primitives, authored
//   Tier 2 SEMANTIC  — role aliases, DERIVED from core when not authored
//   Tier 3 TEMPLATE  — namespaced per-template knobs
//
// Every variable is prefixed --st- so third-party widgets embedded in a
// generated site cannot collide with ours.
// ============================================================================

import type { LayeredTheme, TemplateManifest } from "@site/schema";
import { tokenToVar } from "@site/schema";
import type { ResolvedTheme } from "./types";
import { cssValue } from "./escape";

// ============================================================================
// COLOUR HELPERS
// ============================================================================

interface Rgb { r: number; g: number; b: number }

/** Parse #rgb / #rrggbb. Returns null for anything else (named, rgb(), oklch()). */
function parseHex(input: string): Rgb | null {
  const hex = input.trim().replace(/^#/, "");

  if (/^[0-9a-f]{3}$/i.test(hex)) {
    return {
      r: parseInt(hex[0] + hex[0], 16),
      g: parseInt(hex[1] + hex[1], 16),
      b: parseInt(hex[2] + hex[2], 16),
    };
  }

  if (/^[0-9a-f]{6}$/i.test(hex)) {
    return {
      r: parseInt(hex.slice(0, 2), 16),
      g: parseInt(hex.slice(2, 4), 16),
      b: parseInt(hex.slice(4, 6), 16),
    };
  }

  return null;
}

function toHex({ r, g, b }: Rgb): string {
  const clamp = (n: number) => Math.max(0, Math.min(255, Math.round(n)));
  return `#${[r, g, b].map((n) => clamp(n).toString(16).padStart(2, "0")).join("")}`;
}

/**
 * Shift a colour toward black (negative) or white (positive), 0..1.
 *
 * Used only to synthesise a hover state when the author didn't supply one.
 * Falls back to returning the input unchanged for non-hex colours, so an
 * `oklch()` or `var()` value passes through rather than producing garbage.
 */
function shade(color: string, amount: number): string {
  const rgb = parseHex(color);
  if (!rgb) return color;

  const target = amount < 0 ? 0 : 255;
  const t = Math.abs(amount);

  return toHex({
    r: rgb.r + (target - rgb.r) * t,
    g: rgb.g + (target - rgb.g) * t,
    b: rgb.b + (target - rgb.b) * t,
  });
}

/** Relative luminance per WCAG 2.x. Used to pick legible text over a colour. */
function luminance(color: string): number {
  const rgb = parseHex(color);
  if (!rgb) return 0.5;   // unknown format: assume mid, caller picks a safe default

  const channel = (v: number) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };

  return 0.2126 * channel(rgb.r) + 0.7152 * channel(rgb.g) + 0.0722 * channel(rgb.b);
}

/** Contrast ratio between two colours, 1..21. */
export function contrastRatio(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

// ============================================================================
// TYPE SCALE
// ============================================================================

/** Parse "16px" / "1rem" into { value, unit }. */
function parseLength(input: string): { value: number; unit: string } {
  const match = /^(-?[\d.]+)\s*([a-z%]*)$/i.exec(input.trim());
  if (!match) return { value: 16, unit: "px" };
  return { value: parseFloat(match[1]), unit: match[2] || "px" };
}

/**
 * Generate h1..h6 from baseFontSize and scaleRatio.
 *
 * The original template hardcoded 72/56/32px, so a theme could not rescale
 * typography at all. scaleRatio existed in the schema from the start but was
 * never wired to anything — this is that wiring.
 *
 * h6 sits at the base size; each step up multiplies by the ratio.
 */
function typeScale(baseFontSize: string, ratio: number): Record<string, string> {
  const { value, unit } = parseLength(baseFontSize);
  const scale: Record<string, string> = {};

  for (let level = 1; level <= 6; level++) {
    const steps = 6 - level;   // h1 = 5 steps up, h6 = 0
    const size = value * ratio ** steps;
    scale[`--st-font-size-h${level}`] = `${round(size)}${unit}`;
  }

  // Unlike h1..h6, this one has a real token path — route it through
  // tokenToVar() like everything else rather than repeating the literal.
  scale[tokenToVar("core.typography.baseFontSize")] = `${value}${unit}`;
  return scale;
}

function round(n: number): number {
  return Math.round(n * 1000) / 1000;
}

// ============================================================================
// INHERITANCE
// ============================================================================

type Plain = Record<string, unknown>;

function isPlainObject(v: unknown): v is Plain {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Recursive merge. `source` wins. Arrays replace rather than concatenate. */
export function deepMerge<T>(target: T, source: unknown): T {
  if (!isPlainObject(source)) return target;
  if (!isPlainObject(target)) return source as T;

  const out: Plain = { ...target };

  for (const [key, value] of Object.entries(source)) {
    if (value === undefined) continue;
    out[key] = isPlainObject(value) && isPlainObject(out[key])
      ? deepMerge(out[key], value)
      : value;
  }

  return out as T;
}

// ============================================================================
// RESOLUTION
// ============================================================================

export interface ResolveThemeInput {
  theme: LayeredTheme;
  /** Per-site deviations, applied after `extends`. */
  override?: Record<string, unknown>;
  /** Parent theme when `theme.extends` is set. Caller does the lookup. */
  parent?: LayeredTheme;
  manifest: TemplateManifest;
}

/**
 * Collapse a LayeredTheme into concrete CSS variables.
 *
 * Order: parent -> theme -> per-site override -> derived semantics.
 * Every semantic token is filled here so templates never implement fallbacks.
 */
export function resolveTheme(input: ResolveThemeInput): ResolvedTheme {
  const { manifest } = input;

  // ---- 1. Inheritance chain ----
  let theme = input.theme;
  if (input.parent) theme = deepMerge(input.parent, theme);
  if (input.override) theme = deepMerge(theme, input.override);

  const c = theme.core.colors;
  const t = theme.core.typography;
  const s = theme.core.spacing;
  const m = theme.core.motion;

  // ---- 2. Semantic derivation ----
  // Authored values win; anything absent is computed from core.
  const sem = theme.semantic ?? {};

  const primaryHover   = c.primaryHover   ?? shade(c.primary, -0.15);
  const secondaryHover = c.secondaryHover ?? shade(c.secondary, -0.15);
  const heading        = c.heading        ?? c.text;
  const onSecondary    = c.onSecondary    ?? c.onPrimary;

  // Text over a scrimmed photo. The scrim darkens, so light text is almost
  // always right — but respect an explicitly light background theme.
  const textOnImage = sem.textOnImage
    ?? (contrastRatio("#ffffff", c.overlay) > 3 ? "#ffffff" : c.text);

  // Every key goes through tokenToVar() rather than a literal — that's the
  // whole point. A hardcoded "--st-x" here can drift from what token-vars.ts
  // declares without either side erroring; routing through the same function
  // token-vars.ts exports makes that drift impossible instead of just unlikely.
  const vars: Record<string, string> = {
    // ---- Colours ----
    [tokenToVar("core.colors.background")]:    cssValue(c.background),
    [tokenToVar("core.colors.surface")]:       cssValue(c.surface),
    [tokenToVar("core.colors.primary")]:       cssValue(c.primary),
    [tokenToVar("core.colors.primaryHover")]:  cssValue(primaryHover),
    [tokenToVar("core.colors.onPrimary")]:     cssValue(c.onPrimary),
    [tokenToVar("core.colors.secondary")]:     cssValue(c.secondary),
    [tokenToVar("core.colors.secondaryHover")]: cssValue(secondaryHover),
    [tokenToVar("core.colors.onSecondary")]:   cssValue(onSecondary),
    [tokenToVar("core.colors.text")]:          cssValue(c.text),
    [tokenToVar("core.colors.textMuted")]:     cssValue(c.textMuted),
    [tokenToVar("core.colors.heading")]:       cssValue(heading),
    [tokenToVar("core.colors.border")]:        cssValue(c.border),
    [tokenToVar("core.colors.overlay")]:       cssValue(c.overlay),
    [tokenToVar("core.colors.success")]:       cssValue(c.success),
    [tokenToVar("core.colors.warning")]:       cssValue(c.warning),
    [tokenToVar("core.colors.error")]:         cssValue(c.error),
    [tokenToVar("core.colors.info")]:          cssValue(c.info ?? c.secondary),

    // ---- Semantic ----
    [tokenToVar("semantic.textOnImage")]:          cssValue(textOnImage),
    [tokenToVar("semantic.surfaceElevated")]:      cssValue(sem.surfaceElevated ?? shade(c.surface, 0.06)),
    [tokenToVar("semantic.navBackground")]:        cssValue(sem.navBackground ?? "rgba(0,0,0,.2)"),
    [tokenToVar("semantic.navForeground")]:        cssValue(sem.navForeground ?? c.text),
    [tokenToVar("semantic.footerBackground")]:     cssValue(sem.footerBackground ?? c.surface),
    [tokenToVar("semantic.footerForeground")]:     cssValue(sem.footerForeground ?? c.textMuted),
    [tokenToVar("semantic.footerBorder")]:         cssValue(sem.footerBorder ?? c.border),
    [tokenToVar("semantic.overlayScrim")]:         cssValue(sem.overlayScrim ?? c.overlay),
    [tokenToVar("semantic.mobileMenuBackground")]: cssValue(sem.mobileMenuBackground ?? c.surface),

    // ---- Typography ----
    [tokenToVar("core.typography.fontFamilyBase")]:      cssValue(t.fontFamilyBase, "system-ui, sans-serif"),
    [tokenToVar("core.typography.fontFamilyHeading")]:   cssValue(t.fontFamilyHeading ?? t.fontFamilyBase, "system-ui, sans-serif"),
    [tokenToVar("core.typography.fontFamilyMono")]:      cssValue(t.fontFamilyMono ?? "ui-monospace, monospace"),
    [tokenToVar("core.typography.fontWeightNormal")]:    String(t.fontWeightNormal),
    [tokenToVar("core.typography.fontWeightMedium")]:    String(t.fontWeightMedium ?? 500),
    [tokenToVar("core.typography.fontWeightBold")]:      String(t.fontWeightBold),
    [tokenToVar("core.typography.lineHeightBase")]:      String(t.lineHeightBase),
    [tokenToVar("core.typography.lineHeightHeading")]:   String(t.lineHeightHeading),
    [tokenToVar("core.typography.letterSpacingTight")]:  cssValue(t.letterSpacingTight ?? "normal"),
    [tokenToVar("core.typography.letterSpacingWide")]:   cssValue(t.letterSpacingWide ?? "0.1em"),
    [tokenToVar("core.typography.headingTransform")]:    cssValue(t.headingTransform, "none"),
    [tokenToVar("core.typography.kickerTransform")]:     cssValue(t.kickerTransform, "uppercase"),

    // ---- Spacing (logical axes) ----
    [tokenToVar("core.spacing.unit")]:                cssValue(s.unit),
    [tokenToVar("core.spacing.containerMaxInline")]:  cssValue(s.containerMaxInline),
    [tokenToVar("core.spacing.contentMaxInline")]:    cssValue(s.contentMaxInline),
    [tokenToVar("core.spacing.sectionPaddingBlock")]: cssValue(s.sectionPaddingBlock),
    [tokenToVar("core.spacing.sectionPaddingInline")]: cssValue(s.sectionPaddingInline),
    [tokenToVar("core.spacing.radius")]:              cssValue(s.radius),
    [tokenToVar("core.spacing.radiusSm")]:            cssValue(s.radiusSm ?? s.radius),
    [tokenToVar("core.spacing.radiusLg")]:            cssValue(s.radiusLg ?? s.radius),

    // ---- Motion ----
    [tokenToVar("core.motion.speed")]:  cssValue(m.speed),
    [tokenToVar("core.motion.easing")]: cssValue(m.easing),

    // ---- Shadows ----
    [tokenToVar("core.shadows.sm")]: cssValue(theme.core.shadows?.sm ?? "none"),
    [tokenToVar("core.shadows.md")]: cssValue(theme.core.shadows?.md ?? "none"),
    [tokenToVar("core.shadows.lg")]: cssValue(theme.core.shadows?.lg ?? "none"),

    // ---- Button ---- 
    [tokenToVar("core.button.textTransform")]: cssValue(theme.core.button.textTransform),
    [tokenToVar("core.button.paddingBlock")]: cssValue(theme.core.button.paddingBlock),
    [tokenToVar("core.button.paddingInline")]: cssValue(theme.core.button.paddingInline),
    // letterSpacingWide when set, "normal" otherwise — BASE_CORE deliberately
    // leaves letterSpacingWide unset, so a base-theme uppercase button must
    // not get tracking nobody authored. A template that wants it says so.
    [tokenToVar("core.button.letterSpacing")]: cssValue(theme.core.button.letterSpacing ?? (theme.core.button.textTransform === "uppercase" ? theme.core.typography.letterSpacingWide ?? "normal" : "normal")),
    [tokenToVar("core.button.borderWidth")]: cssValue(theme.core.button.borderWidth),
    [tokenToVar("core.button.borderColor")]: cssValue(theme.core.button.borderColor ?? c.primary),



    // ---- Type scale ----
    // Computed from baseFontSize + scaleRatio, not a 1:1 token — these six
    // names have no VAR_NAMES entry, only a listing in token-vars.ts's
    // GENERATED_VAR_NAMES so the declared/emitted test still sees them.
    ...typeScale(t.baseFontSize, t.scaleRatio ?? 1.25),
  };

  // ---- 3. Template-scoped tokens (Tier 3) ----
  // Manifest defaults first, then any authored values for this template id.
  // Namespaced so a side-scroller knob never leaks into the shared surface.
  const custom: Record<string, string> = {};
  const schema = manifest.customThemeSchema ?? {};
  const authored = theme.templates?.[manifest.id] ?? {};

  for (const [key, spec] of Object.entries(schema)) {
    const value = authored[key] ?? spec.default;
    custom[tokenToVar(`templates.${manifest.id}.${key}`)] = cssValue(String(value));
  }

  return {
    vars,
    custom,
    mode: theme.mode ?? "dark",
    raw: {
      breakpointMd: theme.core.breakpoints.md,
      respectReducedMotion: m.respectReducedMotion,
      fontFamilyBase: t.fontFamilyBase,
      fontFamilyHeading: t.fontFamilyHeading ?? t.fontFamilyBase,
    },
  };
}

// ============================================================================
// FLATTENING
// ============================================================================

/**
 * Emit the :root block.
 *
 * This is what collapses the original template's ~19 separate CSS expressions
 * into a single interpolation. Everything downstream reads var(--st-*).
 */
export function flattenTheme(theme: ResolvedTheme): string {
  const declarations = [
    ...Object.entries(theme.vars),
    ...Object.entries(theme.custom),
  ]
    .map(([name, value]) => `  ${name}: ${value};`)
    .join("\n");

  const mobileScale = generateMobileScale(theme);

  return [
    `:root {`,
    `  color-scheme: ${theme.mode};`,
    declarations,
    `}`,
    mobileScale,
    theme.raw.respectReducedMotion ? REDUCED_MOTION_BLOCK : "",
  ]
    .filter(Boolean)
    .join("\n");
}

/**
 * Shrink the type scale below the md breakpoint.
 *
 * Replaces the original template's hand-written mobile font sizes (42/34/22px),
 * which had to be edited in lockstep with the desktop values and inevitably
 * drifted.
 */
function generateMobileScale(theme: ResolvedTheme): string {
  const factor = 0.72;   // matches scaleRatioMobile's default intent

  const lines = Object.entries(theme.vars)
    .filter(([name]) => name.startsWith("--st-font-size-h"))
    .map(([name, value]) => {
      const { value: n, unit } = parseLength(value);
      return `    ${name}: ${round(n * factor)}${unit};`;
    })
    .join("\n");

  if (!lines) return "";

  return [
    `@media (max-width: ${cssValue(theme.raw.breakpointMd, "768px")}) {`,
    `  :root {`,
    lines,
    `  }`,
    `}`,
  ].join("\n");
}

const REDUCED_MOTION_BLOCK = `@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
    scroll-behavior: auto !important;
  }
}`;