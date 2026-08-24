// ============================================================================
// site-platform/schema/token-vars.ts
//
// Token path -> CSS custom property name. THE canonical mapping.
//
// resolveTheme() must import this rather than deriving names its own way. Two
// implementations means a rename produces CSS referencing variables nothing
// declares — and because `rewriteCss` emits `var(--st-x, <original literal>)`,
// the page still LOOKS right while every theme control silently does nothing.
// That's the worst possible failure mode: invisible, and it survives review.
//
// The mapping is a table, not a transform, because the established names are
// irregular — `--st-color-bg` from `colors.background`, `--st-font-size-h1`
// from a generated scale. Attempting to be mechanical here produced two
// plausible answers for half the tokens.
//
// An unknown token THROWS. A typo in the rule table is a build failure, not a
// dead variable.
// ============================================================================

const VAR_NAMES: Record<string, string> = {
  // ---- core.colors ----
  "core.colors.background": "--st-color-bg",
  "core.colors.surface": "--st-color-surface",
  "core.colors.primary": "--st-color-primary",
  "core.colors.primaryHover": "--st-color-primary-hover",
  "core.colors.onPrimary": "--st-color-on-primary",
  "core.colors.secondary": "--st-color-secondary",
  "core.colors.secondaryHover": "--st-color-secondary-hover",
  "core.colors.onSecondary": "--st-color-on-secondary",
  "core.colors.text": "--st-color-text",
  "core.colors.textMuted": "--st-color-text-muted",
  "core.colors.heading": "--st-color-heading",
  "core.colors.border": "--st-color-border",
  "core.colors.overlay": "--st-color-overlay",
  "core.colors.success": "--st-color-success",
  "core.colors.warning": "--st-color-warning",
  "core.colors.error": "--st-color-error",
  "core.colors.info": "--st-color-info",

  // ---- core.typography ----
  // Note the reorder: `baseFontSize` becomes `font-size-base`, matching the
  // generated scale's `--st-font-size-h1..h6` rather than the property name.
  "core.typography.fontFamilyBase": "--st-font-family-base",
  "core.typography.fontFamilyHeading": "--st-font-family-heading",
  "core.typography.fontFamilyMono": "--st-font-family-mono",
  "core.typography.baseFontSize": "--st-font-size-base",
  "core.typography.fontWeightNormal": "--st-font-weight-normal",
  "core.typography.fontWeightMedium": "--st-font-weight-medium",
  "core.typography.fontWeightBold": "--st-font-weight-bold",
  "core.typography.lineHeightBase": "--st-line-height-base",
  "core.typography.lineHeightHeading": "--st-line-height-heading",
  "core.typography.letterSpacingTight": "--st-letter-spacing-tight",
  "core.typography.letterSpacingWide": "--st-letter-spacing-wide",
  "core.typography.headingTransform": "--st-heading-transform",
  "core.typography.kickerTransform": "--st-kicker-transform",

  // ---- core.spacing ----
  "core.spacing.unit": "--st-space-unit",
  "core.spacing.containerMaxInline": "--st-container-max-inline",
  "core.spacing.contentMaxInline": "--st-content-max-inline",
  "core.spacing.sectionPaddingBlock": "--st-section-padding-block",
  "core.spacing.sectionPaddingInline": "--st-section-padding-inline",
  "core.spacing.radius": "--st-radius",
  "core.spacing.radiusSm": "--st-radius-sm",
  "core.spacing.radiusLg": "--st-radius-lg",

  // ---- core.motion ----
  "core.motion.speed": "--st-motion-speed",
  "core.motion.easing": "--st-motion-easing",

  // ---- core.shadows ----
  "core.shadows.sm": "--st-shadow-sm",
  "core.shadows.md": "--st-shadow-md",
  "core.shadows.lg": "--st-shadow-lg",

  // ---- core.button ----
  "core.button.textTransform": "--st-button-transform",
  "core.button.paddingBlock": "--st-button-padding-block",
  "core.button.paddingInline": "--st-button-padding-inline",
  "core.button.letterSpacing": "--st-button-letter-spacing",
  "core.button.borderWidth": "--st-button-border-width",
  "core.button.borderColor": "--st-button-border-color",

  // ---- semantic ----
  "semantic.textOnImage": "--st-color-text-on-image",
  "semantic.surfaceElevated": "--st-color-surface-elevated",
  "semantic.navBackground": "--st-nav-bg",
  "semantic.navForeground": "--st-nav-fg",
  "semantic.mobileMenuBackground": "--st-mobile-menu-bg",
  "semantic.footerBackground": "--st-footer-bg",
  "semantic.footerForeground": "--st-footer-fg",
  "semantic.footerBorder": "--st-footer-border",
  "semantic.overlayScrim": "--st-color-overlay-scrim",
};

/**
 * Tier 3 is the one mechanical case: `templates.{id}.{key}` -> `--st-tpl-{key}`.
 *
 * The `--st-tpl-` prefix is load-bearing. Template-scoped tokens go in
 * ResolvedTheme.custom, never in .vars, and the prefix is what makes a leak
 * between the two visible in a test.
 */
const TIER3 = /^templates\.[^.]+\.(.+)$/;

export function tokenToVar(token: string): string {
  const known = VAR_NAMES[token];
  if (known) return known;

  const tier3 = token.match(TIER3);
  if (tier3) return `--st-tpl-${sanitizeIdent(kebab(tier3[1]))}`;

  throw new Error(
    `No CSS variable mapped for token "${token}". ` +
    `Add it to VAR_NAMES in schema/token-vars.ts.`,
  );
}

/** True when a token has a variable. For callers that want to skip, not throw. */
export const hasVar = (token: string): boolean =>
  token in VAR_NAMES || TIER3.test(token);

const kebab = (value: string): string =>
  value.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase();

/**
 * Mirrors renderer/escape.ts's cssIdent() — duplicated rather than imported,
 * since schema/ doesn't depend on renderer/. Template-scoped keys come from
 * manifest.customThemeSchema, but stripping anything outside a CSS identifier
 * before it becomes part of a variable name costs nothing and closes off a
 * class of mistake for free.
 */
const sanitizeIdent = (value: string): string => value.replace(/[^a-zA-Z0-9_-]/g, "");

/**
 * Generated by resolveTheme's typeScale() from core.typography.baseFontSize +
 * scaleRatio — six computed sizes, not a 1:1 field mapping, so they have no
 * entry in VAR_NAMES above. Listed here only so ALL_VAR_NAMES stays complete
 * for the declared-vs-emitted test; tokenToVar() still throws if anything
 * tries to look one of these up by a token path, correctly, since none exists.
 */
const GENERATED_VAR_NAMES = [
  "--st-font-size-h1",
  "--st-font-size-h2",
  "--st-font-size-h3",
  "--st-font-size-h4",
  "--st-font-size-h5",
  "--st-font-size-h6",
] as const;

/**
 * Every variable name this module can emit.
 *
 * The invariant worth testing: every name resolveTheme DECLARES appears here,
 * and every name here is declared. A one-line test over both sets catches the
 * silent-no-op failure described at the top of this file.
 */
export const ALL_VAR_NAMES: readonly string[] = [
  ...Object.values(VAR_NAMES),
  ...GENERATED_VAR_NAMES,
];