// ============================================================
// SiteTheme — drives all CSS custom properties for generated
// one-page static sites. Keep this as the single source of
// truth; templates should consume theme.* and never hardcode colors/fonts.
// ============================================================

export interface SiteTheme {
  // ---- Identity (optional, useful for saving/listing themes) ----
  id?: string;
  name?: string;

  // ---- Core color palette ----
  colors: {
    background: string;       // page background
    surface: string;          // cards, panels, modals (usually a shade off background)
    primary: string;          // main brand color (CTAs, links, highlights)
    primaryHover?: string;    // hover/active state for primary (fallback: darken primary)
    secondary: string;        // accent/complementary color
    secondaryHover?: string;
    text: string;             // main body text color
    textMuted: string;        // secondary text (subtitles, captions, placeholders)
    heading?: string;         // heading color, defaults to `text` if omitted
    border: string;           // dividers, input borders, card outlines
    success: string;
    warning: string;
    error: string;
    info?: string;
    overlay?: string;         // for modals/hero overlays, usually rgba() with alpha
  };

  // ---- Typography ----
  typography: {
    fontFamilyBase: string;       // body copy, e.g. "'Inter', sans-serif"
    fontFamilyHeading?: string;   // defaults to fontFamilyBase if omitted
    fontFamilyMono?: string;      // for code blocks / stats if template needs it

    baseFontSize: string;         // e.g. "16px" — root sizing anchor for rem scale
    scaleRatio?: number;          // type scale ratio (e.g. 1.25) if generating h1-h6 dynamically

    fontWeightNormal: number;     // e.g. 400
    fontWeightMedium?: number;    // e.g. 500
    fontWeightBold: number;       // e.g. 700

    lineHeightBase: number;       // e.g. 1.6
    lineHeightHeading?: number;   // e.g. 1.2
  };

  // ---- Spacing & layout ----
  spacing: {
    unit: string;              // base spacing unit, e.g. "8px" — everything else multiplies this
    containerMaxWidth: string; // e.g. "1200px"
    sectionPaddingY: string;   // vertical padding between page sections
    borderRadius: string;      // default corner radius for buttons/cards/inputs
    borderRadiusSm?: string;
    borderRadiusLg?: string;
  };

  // ---- Shadows / elevation ----
  shadows?: {
    sm?: string;
    md?: string;
    lg?: string;
  };

  // ---- Buttons (since CTAs are central to one-pagers) ----
  button?: {
    paddingX: string;
    paddingY: string;
    borderRadius?: string;   // falls back to spacing.borderRadius
    fontWeight?: number;
    transition?: string;     // e.g. "all 0.2s ease"
  };

  // ---- Assets / branding ----
  assets?: {
    logoUrl?: string;
    faviconUrl?: string;
    heroImageUrl?: string;
  };

  // ---- Misc theming flags ----
  mode?: "light" | "dark";       // helps templates pick sensible defaults / toggle logic
  transitionSpeed?: string;      // e.g. "0.2s" — global animation speed knob
}