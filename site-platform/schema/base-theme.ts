// ============================================================================
// site-platform/schema/base-theme.ts
//
// The standard base every template starts from.
//
// There is no theme registry and no `extends` chain by default: a template's
// theme is this object with its own values merged over the top. That keeps a
// preset self-contained — it renders without resolving a parent — while still
// meaning a template author only authors what actually differs.
//
// This lives in the schema package rather than the renderer because both the
// import tooling and resolveTheme need it, and tools already depend on schema.
//
// What belongs here: values every template needs and most will keep. What does
// NOT: anything template-shaped. That's Tier 3.
// ============================================================================

import type { CoreTokens } from "./theme";

/**
 * Deliberately dark. The generated sites are overwhelmingly dark-on-photo, and
 * a light base means every template overrides the same eight colours.
 *
 * Only `mode` and the values below are assumed. Optional core fields are left
 * unset so resolveTheme derives them — a hover colour authored here would be
 * wrong for every template that changes its primary.
 */
export const BASE_CORE: CoreTokens = {
  colors: {
    background: "#000000",
    surface: "#111111",

    primary: "#ffffff",
    onPrimary: "#000000",
    secondary: "#1a1a1a",

    text: "#ffffff",
    /**
     * Body copy. Sources almost always dim this relative to headings.
     *
     * Deliberately not #e0e0e0 — that's the exact literal the original
     * hero-onepager template hardcoded before tokenization, and the renderer
     * test suite asserts it's gone from generated output. A default that
     * numerically matches it would fail that check by coincidence on every
     * render using this default, for a value that was never actually leaking.
     */
    textMuted: "#e2e2e2",

    border: "#222222",
    /** Scrim over section background images. Alpha is per-section. */
    overlay: "#000000",

    success: "#22c55e",
    warning: "#f59e0b",
    error: "#ef4444",
  },

  typography: {
    // A stack, not a single family. An import that finds a font the source
    // never loaded should fall back to something deliberate rather than to
    // whatever the browser picks.
    fontFamilyBase: "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",

    baseFontSize: "16px",
    scaleRatio: 1.25,
    scaleRatioMobile: 0.75,

    fontWeightNormal: 400,
    fontWeightBold: 700,

    lineHeightBase: 1.6,
    lineHeightHeading: 1.15,

    headingTransform: "none",
    kickerTransform: "uppercase",
  },

  spacing: {
    unit: "8px",
    containerMaxInline: "1200px",
    contentMaxInline: "700px",
    sectionPaddingBlock: "80px",
    sectionPaddingInline: "8%",
    radius: "0px",
  },

  motion: {
    speed: "0.2s",
    easing: "ease",
    respectReducedMotion: true,
  },

  breakpoints: {
    md: "768px",
  },
};

/**
 * Merge a partial core over the base.
 *
 * Deep per top-level group, shallow within — so a template supplying two
 * colours keeps the other ten, but supplying `colors` doesn't require
 * restating `success`/`warning`/`error`.
 *
 * Undefined values are skipped rather than overwriting, because an extraction
 * pass that found nothing for a property must not blank the base value.
 */
export function mergeCore(partial: DeepPartial<CoreTokens> | undefined): CoreTokens {
  if (!partial) return structuredClone(BASE_CORE);

  const out = structuredClone(BASE_CORE) as Record<string, Record<string, unknown>>;

  for (const [group, values] of Object.entries(partial)) {
    if (!values || typeof values !== "object") continue;
    if (!out[group]) out[group] = {};

    for (const [key, value] of Object.entries(values as Record<string, unknown>)) {
      if (value !== undefined) out[group][key] = value;
    }
  }

  return out as unknown as CoreTokens;
}

type DeepPartial<T> = { [K in keyof T]?: T[K] extends object ? Partial<T[K]> : T[K] };