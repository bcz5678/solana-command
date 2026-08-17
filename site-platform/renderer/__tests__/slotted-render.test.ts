// ============================================================================
// site-platform/renderer/__tests__/slotted-render.test.ts
//
// renderSlotted() had never executed under test before this file — three of
// the four bugs surfaced in the first audit of this codebase were
// ReferenceError on first execution, which only running the path finds. One
// end-to-end render is worth more than a pile of fine-grained assertions here;
// the fine-grained coverage for apply/extract symmetry lives in
// slotted-symmetry.test.ts instead.
//
// Not snapshot-tested: this exercises the mapping this test authors by hand,
// not the import pipeline's inference, so there's no "intended output" for a
// snapshot to hold constant against.
// ============================================================================

import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { TemplateManifest, SiteDefinition, ImageAsset } from "@site/schema";
import { renderSlotted, registerSlottedTemplate } from "../slotted/index";
import { normalizeSource } from "../../../tools/template-import/normalize";

const HERE = dirname(fileURLToPath(import.meta.url));
const CARD_GRID_RAW = readFileSync(
  join(HERE, "..", "..", "..", "tools", "template-import", "__fixtures__", "card-grid.html"),
  "utf8",
);

// Production only ever registers a NORMALIZED source — trimHrefs runs once at
// `import-template init`, not at render time (rewriteAnchors matches
// `a[href^="#"]`, which a raw `href=" #features"` fails outright). Mirroring
// that here rather than registering the raw fixture is what makes this an
// honest end-to-end test instead of one that fails on the fixture's own
// leading-whitespace href.
const CARD_GRID = normalizeSource(CARD_GRID_RAW).html;

const SOURCE_KEY = "card-grid-test@1";

function image(id: string): ImageAsset {
  return {
    id,
    stagingKey: `site/${id}/original.png`,
    url: `https://staging.example/${id}.png`,
    alt: "Hero image",
    decorative: false,
    width: 1200,
    height: 800,
    focalX: 0.5,
    focalY: 0.5,
    variants: { "1200": `site/${id}/1200.webp` },
  } as ImageAsset;
}

const theme: SiteDefinition["theme"] = {
  id: "slotted-fixture",
  name: "Slotted Fixture",
  schemaVersion: 1,
  mode: "dark",
  core: {
    colors: {
      background: "#0b0b0f", surface: "#15151c", primary: "#7c5cff", onPrimary: "#ffffff",
      secondary: "#22d3ee", text: "#f4f4f5", textMuted: "#a1a1aa", border: "#27272a",
      overlay: "rgba(0,0,0,0.55)", success: "#22c55e", warning: "#f59e0b", error: "#ef4444",
    },
    typography: {
      fontFamilyBase: "Inter, sans-serif", baseFontSize: "16px", scaleRatio: 1.25,
      scaleRatioMobile: 0.72, fontWeightNormal: 400, fontWeightBold: 700,
      lineHeightBase: 1.6, lineHeightHeading: 1.15, headingTransform: "none", kickerTransform: "uppercase",
    },
    spacing: {
      unit: "8px", containerMaxInline: "1200px", contentMaxInline: "700px",
      sectionPaddingBlock: "80px", sectionPaddingInline: "8%", radius: "4px",
    },
    motion: { speed: "0.2s", easing: "ease", respectReducedMotion: true },
    breakpoints: { md: "768px" },
  },
};

const definition: SiteDefinition = {
  schemaVersion: 1,
  templateId: "card-grid-test",
  templateVersion: "1.0.0",
  theme,
  content: {
    schemaVersion: 1,
    meta: {
      fqdn: "cardgrid.test",
      title: "Card Grid Test",
      description: "A slotted-render fixture.",
      locale: "en",
      noindex: true,
    },
    brand: { name: "Card Grid" },
    hero: {
      kicker: "STILL LIVE",
      title: "Buy the dip, or don't",
      body: ["Content swapped in through a selector, not a render function."],
      backgroundImage: image("hero"),
      overlayDirection: "uniform",
      contentAnchor: "block-center",
      crossAlign: "start",
      ctas: [{ label: "Buy now", href: "https://dex.example/swap", external: true, variant: "primary" }],
    },
    // Array order here has to match the NAV's anchor order (Features, About,
    // FAQ), not document order (About, Features, FAQ) — rewriteAnchors maps
    // anchors to ctx.sections positionally, and ctx.sections is this array in
    // array order, not sorted by the `order` field.
    sections: [
      {
        type: "cards",
        id: "11111111-1111-1111-1111-111111111111",
        slug: "features",
        order: 1,
        enabled: true,
        navLabel: "Features",
        showInNav: true,
        title: "Features",
        // No <img> or inline style anywhere for this one — the only thing
        // that can carry it is the cssBackgrounds override below.
        backgroundImage: image("features-bg"),
        overlayDirection: "uniform",
        contentAnchor: "block-center",
        crossAlign: "start",
        cards: [
          { id: "c1", title: "Replaced Card One", body: "First replaced card." },
          { id: "c2", title: "Replaced Card Two", body: "Second replaced card." },
          { id: "c3", title: "Replaced Card Three", body: "Third replaced card." },
        ],
      },
      {
        type: "prose",
        id: "22222222-2222-2222-2222-222222222222",
        slug: "about",
        order: 0,
        enabled: true,
        navLabel: "About",
        showInNav: true,
        title: "About the project",
        body: [],
        overlayDirection: "uniform",
        contentAnchor: "block-center",
        crossAlign: "start",
      },
      {
        type: "prose",
        id: "33333333-3333-3333-3333-333333333333",
        slug: "faq",
        order: 2,
        enabled: true,
        navLabel: "FAQ",
        showInNav: true,
        title: "Questions",
        body: [],
        overlayDirection: "uniform",
        contentAnchor: "block-center",
        crossAlign: "start",
      },
    ],
    social: [],
    footer: { legal: { copyrightYear: "auto" }, links: [] },
  },
};

const manifest: TemplateManifest = {
  id: "card-grid-test",
  name: "Card Grid Test",
  description: "Slotted render fixture",
  version: "1.0.0",
  previewImage: "",
  rendererKey: "card-grid-test",
  flow: "vertical",
  supportedSectionTypes: ["cards", "prose"],
  sectionCount: { min: 0, max: 12 },
  supportsModules: [],
  requiredContent: [],
  dependencies: [],
  imageAspect: {},
  usesThemeKeys: [],
  kind: "slotted",
  slotted: {
    sourceKey: SOURCE_KEY,
    slots: [
      { selector: "#hero .kicker", path: "hero.kicker", mode: "text", all: false, keepFallback: false },
      { selector: "#hero h1", path: "hero.title", mode: "text", all: false, keepFallback: false },
      { selector: "#hero .content p:nth-of-type(2)", path: "hero.body[0]", mode: "text", all: false, keepFallback: false },
      { selector: "#hero .btn", path: "hero.ctas[0]", mode: "link", all: false, keepFallback: false },
      { selector: "#hero .hero-image", path: "hero.backgroundImage", mode: "image", all: false, keepFallback: false },
    ],
    repeaters: [
      {
        selector: ".card",
        path: "sections[0].cards",
        max: 12,
        slots: [
          { selector: "h3", path: "title", mode: "text", all: false, keepFallback: false },
          { selector: "p", path: "body", mode: "text", all: false, keepFallback: false },
        ],
      },
    ],
    bundleAssets: [],
    sanitize: { approvedScripts: [], allowedOrigins: [], allowIframes: false, allowForms: false, stripSelectors: [] },
    metaInsertSelector: "head",
    rewriteAnchors: true,
    sectionNodes: [{ path: "sections[0]", selector: "#features", navSelector: 'a[href="#features"]' }],
    // #features has no <img> and no inline style in the source — a slot has
    // no selector that reaches a pseudo-element's own generated box, so this
    // is the only way this background can ever become per-site editable.
    cssBackgrounds: [{ path: "sections[0].backgroundImage", selector: "#features", pseudo: "before" }],
  },
};

async function render(mode: "build" | "preview") {
  return renderSlotted({
    definition,
    manifest,
    vendor: [],
    rendererKey: manifest.rendererKey,
    mode,
    s3Prefix: "test-site/",
  });
}

describe("renderSlotted", () => {
  beforeAll(() => {
    registerSlottedTemplate(SOURCE_KEY, CARD_GRID);
  });

  it("renders the card-grid fixture end to end without throwing, in both modes", async () => {
    await expect(render("build")).resolves.toBeDefined();
    await expect(render("preview")).resolves.toBeDefined();
  });

  it("applies slots and clones the repeater", async () => {
    const { html } = await render("build");

    // Text-node serialization, not attribute serialization: an apostrophe
    // isn't special outside an attribute value, so it's written literally.
    expect(html).toContain("Buy the dip, or don't");
    expect(html).toContain("Content swapped in through a selector, not a render function.");

    // Repeater: three new cards, none of the source's originals left behind.
    expect(html).toContain("Replaced Card One");
    expect(html).toContain("Replaced Card Two");
    expect(html).toContain("Replaced Card Three");
    // Anchored with ">" so "Replaced Card One" doesn't count as a match.
    expect(html).not.toContain(">Card One<");
    expect(html.match(/class="card"/g)).toHaveLength(3);
  });

  it("rewrites the nav anchor to the assigned slug", async () => {
    const { html } = await render("build");
    // The source hardcodes href=" #features" (leading whitespace); the section
    // must still end up addressable under its assigned slug.
    expect(html).toContain('href="#features"');
    expect(html).toContain('id="features"');
  });

  // ---- CSS-only backgrounds ----
  // The check the other agent proposed to settle emit/render/ordering in one
  // shot: if this is empty, cssBackgrounds never made it out of emit; if it's
  // present but no url() shows up, emitCssBackgrounds itself is broken; if
  // both are fine but it lands before the bundle's own stylesheet, it loses
  // the cascade silently. Confirmed all three by inspection while building
  // this test — recorded here so a regression in any of them fails loudly.
  describe("cssBackgrounds", () => {
    it("emits a per-site override for a selector no slot can reach", async () => {
      const { html } = await render("build");

      const styleIndex = html.indexOf("<style>#features::before{background-image:url(");
      expect(styleIndex).toBeGreaterThan(-1);
      expect(html).toContain("/media/");

      // Never wrapped in @layer for a slotted template, so whichever rule
      // comes LAST in source order wins an equal-specificity match. Landing
      // before the bundle's own stylesheet would mean this loses silently.
      const bundleLinkIndex = html.indexOf('href="assets/vendor.css"');
      expect(bundleLinkIndex).toBeGreaterThan(-1);
      expect(styleIndex).toBeGreaterThan(bundleLinkIndex);
    });

    it("also appears in the render's returned css, for parity with the tokenized path's RenderOutput shape", async () => {
      const { css } = await render("build");
      expect(css).toContain("#features::before{background-image:url(");
    });
  });

  // ---- Mode seam ----
  // Exactly the invariant the tokenized path already enforces in render.test.ts
  // ("assets" describe block) — a staging URL in published output expires and
  // 403s for every visitor, and the reverse (a /media/ path in a live preview)
  // points at an artifact that was never built.
  describe("mode seam", () => {
    it("build mode rewrites media to a published path and carries no staging URL", async () => {
      const { html } = await render("build");
      expect(html).not.toContain("staging.example");
      expect(html).toContain("/media/");
    });

    it("preview mode keeps the staging URL and emits no /media/ path", async () => {
      const { html } = await render("preview");
      expect(html).toContain("staging.example");
      expect(html).not.toContain("/media/");
    });
  });
});
