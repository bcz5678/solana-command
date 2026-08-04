// ============================================================================
// packages/site-renderer/src/templates/hero-onepager/styles.ts
//
// Port of the original index-template.html stylesheet.
//
// Every colour, size, spacing and timing value now reads from a CSS variable.
// The original had ~19 separate {{$json.fields.*}} interpolations in the CSS
// plus a dozen hardcoded values (rgba(0,0,0,.2) header, #e0e0e0 paragraphs,
// #222 footer border, #333 mobile drawer, 72/56/32px headings) — all of which
// meant a "theme" could only change about half the page.
//
// Sizing uses CSS LOGICAL properties (padding-block / padding-inline,
// scroll-margin-block-start) so the same token names remain meaningful when a
// horizontal template maps block -> X.
//
// This string is wrapped in @layer template by assembleDocument(), so vendor
// stylesheets can never outrank it regardless of selector specificity.
// ============================================================================

import type { ResolvedTheme } from "../../types";
import { cssValue } from "../../escape";

export function heroOnepagerStyles(theme: ResolvedTheme): string {
  const md = cssValue(theme.raw.breakpointMd, "768px");

  return `
/* ---------------------------------------------------------------------------
   Base
   The reset lives in @layer reset (document.ts). This is template-owned look.
--------------------------------------------------------------------------- */

body {
  background: var(--st-color-bg);
  color: var(--st-color-text);
  font-family: var(--st-font-base);
  font-size: var(--st-font-size-base);
  font-weight: var(--st-weight-normal);
  line-height: var(--st-line-height-base);
  -webkit-font-smoothing: antialiased;
}

h1, h2, h3, h4, h5, h6 {
  font-family: var(--st-font-heading);
  color: var(--st-color-heading);
  line-height: var(--st-line-height-heading);
  letter-spacing: var(--st-tracking-tight);
  text-transform: var(--st-heading-transform);
  text-wrap: balance;
}

h1 { font-size: var(--st-font-size-h1); }
h2 { font-size: var(--st-font-size-h2); }
h3 { font-size: var(--st-font-size-h3); }

/* Was hardcoded #e0e0e0, which overrode the themed text colour on every
   paragraph in the document. */
p {
  color: var(--st-color-text-muted);
  text-wrap: pretty;
}

/* ---------------------------------------------------------------------------
   Skip link — was absent entirely.
   A fixed header with icon-only nav links is difficult to bypass by keyboard.
--------------------------------------------------------------------------- */

.skip-link {
  position: absolute;
  inset-block-start: -100%;
  inset-inline-start: 0;
  z-index: 2000;
  padding: 12px 20px;
  background: var(--st-color-primary);
  color: var(--st-color-on-primary);
  text-decoration: none;
}
.skip-link:focus { inset-block-start: 0; }

/* ---------------------------------------------------------------------------
   Header
   Every value here was hardcoded in the original.
--------------------------------------------------------------------------- */

.site-header {
  position: fixed;
  inset-block-start: 0;
  inset-inline: 0;
  z-index: 1000;
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 16px;
  padding-block: calc(var(--st-space-unit) * 3);
  padding-inline: calc(var(--st-space-unit) * 7.5);
  background: var(--st-nav-bg);
  backdrop-filter: blur(var(--st-tpl-header-blur, 8px));
  -webkit-backdrop-filter: blur(var(--st-tpl-header-blur, 8px));
}

.logo {
  font-family: var(--st-font-heading);
  font-size: 1.75rem;
  font-weight: var(--st-weight-bold);
  letter-spacing: var(--st-tracking-wide);
  color: var(--st-nav-fg);
  text-decoration: none;
}

.nav { display: flex; align-items: center; gap: 24px; }

.nav-links {
  display: flex;
  align-items: center;
  gap: 24px;
  list-style: none;
}

.nav-links a {
  color: var(--st-nav-fg);
  text-decoration: none;
  font-size: 0.875rem;
  text-transform: uppercase;
  letter-spacing: var(--st-tracking-wide);
  transition: opacity var(--st-transition-speed) var(--st-transition-easing);
}
.nav-links a:hover { opacity: 0.7; }

.nav-social { display: flex; align-items: center; gap: 16px; }
.nav-social a { display: inline-flex; color: var(--st-nav-fg); }
.nav-social svg { inline-size: 20px; block-size: 20px; fill: currentColor; }

/* Icons inherit currentColor, which is why the original's per-instance
   style="color: {{text_color_reverse}}" attributes are gone. */

/* ---------------------------------------------------------------------------
   Mobile menu toggle
--------------------------------------------------------------------------- */

.menu-toggle {
  display: none;
  flex-direction: column;
  gap: 5px;
  padding: 4px;
}

.menu-toggle .bar {
  inline-size: 25px;
  block-size: 3px;
  background: var(--st-nav-fg);
  transition: transform var(--st-transition-speed) var(--st-transition-easing),
              opacity   var(--st-transition-speed) var(--st-transition-easing);
}

/* Hamburger morphs to an X, so the control's state is visible, not just
   announced. */
.menu-toggle[aria-expanded="true"] .bar:nth-child(1) { transform: translateY(8px) rotate(45deg); }
.menu-toggle[aria-expanded="true"] .bar:nth-child(2) { opacity: 0; }
.menu-toggle[aria-expanded="true"] .bar:nth-child(3) { transform: translateY(-8px) rotate(-45deg); }

/* ---------------------------------------------------------------------------
   Sections
   Background images arrive as an inline --section-bg custom property, so
   ::before stays a single static rule instead of one class per section.
   The original had .starship / .human / .network — content-specific class
   names baked into a supposedly generic template.
--------------------------------------------------------------------------- */

.panel {
  position: relative;
  display: flex;
  align-items: center;
  min-block-size: var(--st-tpl-section-min-height, 100vh);
  padding-block: var(--st-section-pad-block);
  padding-inline: var(--st-section-pad-inline);
  overflow: hidden;
  /* Fixed header offset for anchor jumps — absent in the original, so every
     nav link landed with its heading hidden behind the header. */
  scroll-margin-block-start: var(--st-header-h, 0px);
}

.panel::before {
  content: "";
  position: absolute;
  inset: 0;
  z-index: -2;
  background-image: var(--section-bg, none);
  background-size: cover;
  /* Focal point drives the crop origin, matching what the form previewed. */
  background-position: var(--section-focus, 50% 50%);
}

.panel::after {
  content: "";
  position: absolute;
  inset: 0;
  z-index: -1;
  background: var(--st-overlay-scrim);
  opacity: var(--section-overlay, 0.45);
}

/* No image: skip the scrim so the panel shows its own background colour. */
.panel:not([style*="--section-bg"])::after { opacity: 0; }

.panel[data-align="center"] { justify-content: center; text-align: center; }
.panel[data-align="end"]    { justify-content: flex-end; }

.panel-content {
  position: relative;
  max-inline-size: var(--st-content-max);
  inline-size: 100%;
}

.panel[data-has-image="true"] .panel-content,
.panel[data-has-image="true"] .panel-content p {
  color: var(--st-text-on-image);
}

.kicker {
  display: block;
  margin-block-end: 15px;
  font-size: 0.9375rem;
  text-transform: var(--st-kicker-transform);
  letter-spacing: var(--st-tracking-wide);
  color: var(--st-color-primary);
}

.panel-content h1,
.panel-content h2 { margin-block-end: 25px; }

.panel-content p { margin-block-end: 24px; font-size: 1.125rem; }
.panel-content p:last-of-type { margin-block-end: 32px; }

/* ---------------------------------------------------------------------------
   Buttons
   The original's .btn and .btn:hover were byte-identical, so the 0.3s
   transition animated nothing at all.
--------------------------------------------------------------------------- */

.btn {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding-block: var(--st-tpl-btn-pad-y, 14px);
  padding-inline: var(--st-tpl-btn-pad-x, 34px);
  border: var(--st-tpl-btn-border-width, 2px) solid var(--st-color-primary);
  border-radius: var(--st-radius);
  background: var(--st-color-primary);
  color: var(--st-color-on-primary);
  font-weight: var(--st-weight-bold);
  text-decoration: none;
  text-transform: uppercase;
  letter-spacing: var(--st-tracking-wide);
  transition: background-color var(--st-transition-speed) var(--st-transition-easing),
              border-color     var(--st-transition-speed) var(--st-transition-easing),
              color            var(--st-transition-speed) var(--st-transition-easing);
}

.btn:hover {
  background: var(--st-color-primary-hover);
  border-color: var(--st-color-primary-hover);
}

.btn--outline {
  background: transparent;
  color: var(--st-color-primary);
}
.btn--outline:hover {
  background: var(--st-color-primary);
  color: var(--st-color-on-primary);
}

.btn--secondary {
  background: var(--st-color-secondary);
  border-color: var(--st-color-secondary);
  color: var(--st-color-on-secondary);
}

.cta-row { display: flex; flex-wrap: wrap; gap: 16px; margin-block-end: 32px; }

/* ---------------------------------------------------------------------------
   Contract address module
   Was an <a> with no href containing an <h3> and two <div>s, fired by an
   inline onclick — not focusable, not keyboard-operable, invalid nesting, and
   requiring 'unsafe-inline' in the CSP. Now a real button.
--------------------------------------------------------------------------- */

.contract {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 6px;
  inline-size: 100%;
  max-inline-size: 100%;
  padding: 16px 20px;
  border: 1px solid var(--st-color-border);
  border-radius: var(--st-radius);
  background: var(--st-surface-elevated);
  color: var(--st-color-text);
  text-align: start;
  transition: border-color var(--st-transition-speed) var(--st-transition-easing);
}
.contract:hover { border-color: var(--st-color-primary); }

.contract-label {
  font-size: 0.75rem;
  text-transform: uppercase;
  letter-spacing: var(--st-tracking-wide);
  color: var(--st-color-text-muted);
}

.contract-value {
  font-family: var(--st-font-mono);
  font-size: 0.9375rem;
  word-break: break-all;
}

.contract-status { font-size: 0.75rem; color: var(--st-color-success); }

/* ---------------------------------------------------------------------------
   Section variants
--------------------------------------------------------------------------- */

.stats-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
  gap: 32px;
  margin-block-start: 32px;
}
.stat-value {
  font-family: var(--st-font-heading);
  font-size: var(--st-font-size-h3);
  color: var(--st-color-primary);
}
.stat-label {
  font-size: 0.875rem;
  text-transform: uppercase;
  letter-spacing: var(--st-tracking-wide);
  color: var(--st-color-text-muted);
}

.timeline { list-style: none; margin-block-start: 32px; }
.timeline li {
  position: relative;
  padding-inline-start: 28px;
  padding-block-end: 28px;
  border-inline-start: 2px solid var(--st-color-border);
}
.timeline li:last-child { border-inline-start-color: transparent; padding-block-end: 0; }
.timeline li::before {
  content: "";
  position: absolute;
  inset-inline-start: -7px;
  inset-block-start: 4px;
  inline-size: 12px;
  block-size: 12px;
  border-radius: 50%;
  background: var(--st-color-border);
}
.timeline li[data-status="done"]::before   { background: var(--st-color-success); }
.timeline li[data-status="active"]::before { background: var(--st-color-primary); }
.timeline-marker {
  display: block;
  font-size: 0.8125rem;
  text-transform: uppercase;
  letter-spacing: var(--st-tracking-wide);
  color: var(--st-color-primary);
}

.faq { margin-block-start: 32px; }
.faq details {
  border-block-end: 1px solid var(--st-color-border);
  padding-block: 16px;
}
.faq summary {
  cursor: pointer;
  font-weight: var(--st-weight-bold);
  list-style: none;
}
.faq summary::-webkit-details-marker { display: none; }
.faq summary::after { content: " +"; color: var(--st-color-primary); }
.faq details[open] summary::after { content: " −"; }
.faq details p { margin-block-start: 12px; margin-block-end: 0; }

.cards-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
  gap: 24px;
  margin-block-start: 32px;
}
.card {
  padding: 24px;
  border: 1px solid var(--st-color-border);
  border-radius: var(--st-radius);
  background: var(--st-surface-elevated);
}
.card img {
  inline-size: 100%;
  aspect-ratio: 4 / 3;
  object-fit: cover;
  border-radius: var(--st-radius-sm);
  margin-block-end: 16px;
}

/* ---------------------------------------------------------------------------
   Hero social row
   The original spaced these with runs of &nbsp;.
--------------------------------------------------------------------------- */

.hero-social {
  display: flex;
  align-items: center;
  gap: var(--st-tpl-social-gap, 24px);
  margin-block-start: 32px;
}
.hero-social span {
  font-size: 0.875rem;
  text-transform: uppercase;
  letter-spacing: var(--st-tracking-wide);
  color: var(--st-color-text-muted);
}
.hero-social a { display: inline-flex; color: currentColor; }
.hero-social svg { inline-size: 32px; block-size: 32px; fill: currentColor; }

/* ---------------------------------------------------------------------------
   Footer
--------------------------------------------------------------------------- */

.site-footer {
  padding-block: calc(var(--st-space-unit) * 5);
  padding-inline: var(--st-section-pad-inline);
  background: var(--st-footer-bg);
  color: var(--st-footer-fg);
  border-block-start: 1px solid var(--st-footer-border);
  text-align: center;
}
.site-footer p { color: var(--st-footer-fg); margin-block-end: 0; font-size: 0.875rem; }
.footer-links {
  display: flex;
  justify-content: center;
  flex-wrap: wrap;
  gap: 20px;
  margin-block-end: 16px;
  list-style: none;
}
.footer-links a { font-size: 0.875rem; text-decoration: none; }
.footer-links a:hover { text-decoration: underline; }
.footer-attribution {
  margin-block-start: 16px;
  font-size: 0.75rem;
  opacity: 0.7;
}

/* ---------------------------------------------------------------------------
   Mobile
   Type sizes come from the generated scale (theme.ts), not hand-written
   overrides — the original had 42/34/22px that had to be edited in lockstep
   with the desktop values and inevitably drifted.
--------------------------------------------------------------------------- */

@media (max-width: ${md}) {
  .site-header { padding-inline: calc(var(--st-space-unit) * 2.5); }

  .menu-toggle { display: flex; }

  .nav-links {
    position: absolute;
    inset-block-start: 100%;
    inset-inline: 0;
    flex-direction: column;
    gap: 0;
    padding-block: 16px;
    background: var(--st-mobile-menu-bg);
    text-align: center;
    /* Collapsed by height rather than display:none so the transition runs and
       the links stay in the DOM for assistive tech to announce state. */
    max-block-size: 0;
    overflow: hidden;
    transition: max-block-size var(--st-transition-speed) var(--st-transition-easing);
  }
  .nav-links[data-open="true"] { max-block-size: 60vh; overflow-y: auto; }
  .nav-links li { inline-size: 100%; }
  .nav-links a { display: block; padding: 12px 20px; }

  .panel { padding-inline: calc(var(--st-space-unit) * 2.5); }
  .hero-social svg { inline-size: 26px; block-size: 26px; }
}
`.trim();
}