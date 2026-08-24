// ============================================================================
// tools/template-import/__tests__/emit.test.ts
//
// Regression test: a cssBackgrounds path that doesn't resolve against the
// preset's own content used to render silently as "no background" — the same
// value a section with no background image at all produces. Nothing at emit
// time distinguished "intentionally blank" from "the path is wrong," so a
// pathFor() indexing bug (merge.test.ts) shipped undetected until someone
// diffed the actual rendered page against the source with Playwright.
//
// emitTemplate() now asserts every cssBackgrounds path resolves to something
// defined in preset.content and blocks the emit — refusing to write files —
// when it doesn't, the same way it already blocks on misaligned sectionNodes.
// ============================================================================

import { describe, it, expect } from "vitest";
import { runImport } from "../pipeline";
import { normalizeSource } from "../normalize";
import { emitTemplate } from "../emit";
import type { TemplatePreset } from "@site/schema";

const HTML = `<!DOCTYPE html><html><head><title>t</title></head><body>
<section id="hero"><h1>Hero</h1></section>
<section id="first"><h2>First</h2></section>
<section id="second"><h2>Second</h2></section>
<section id="third"><h2>Third</h2></section>
</body></html>`;

const CSS = `
#hero::before{background-image:url('assets/hero.jpg')}
#first::before{background-image:url('assets/first.jpg')}
#second::before{background-image:url('assets/second.jpg')}
#third::before{background-image:url('assets/third.jpg')}
#hero::after,#first::after,#second::after,#third::after{background-color:rgba(0,0,0,.3)}
`;

function importFixture() {
  const { html, css } = normalizeSource(`${HTML}<style>${CSS}</style>`);
  return runImport({ html, css, templateName: "emit-blocker-test" });
}

function section(slug: string, hasBackground: boolean, overlayOpacity: number | null = null) {
  return {
    id: `${slug}-id`,
    slug,
    order: 0,
    enabled: true,
    navLabel: slug,
    showInNav: true,
    kicker: slug,
    title: slug,
    type: "prose",
    body: [],
    overlayOpacity,
    overlayDirection: "uniform",
    contentAnchor: "block-center",
    crossAlign: "start",
    ...(hasBackground
      ? {
          backgroundImage: {
            id: `${slug}-image`, stagingKey: `seed/${slug}/`, url: `/seed/${slug}/original.jpg`,
            alt: "", decorative: false, focalX: 0.5, focalY: 0.5,
            variants: { original: `/seed/${slug}/original.jpg` }, seedPath: slug,
          },
        }
      : {}),
  };
}

function basePreset(sections: ReturnType<typeof section>[], heroOverlayOpacity: number | null = 0.35): TemplatePreset {
  return {
    id: "original", templateId: "emit-blocker-test", templateVersion: "1.0.0",
    name: "Original", isDefault: true,
    content: {
      schemaVersion: 1,
      meta: { fqdn: "", title: "t", description: "d", locale: "en", noindex: true },
      brand: { name: "t" },
      hero: {
        kicker: "k", title: "t", body: [],
        backgroundImage: {
          id: "hero-image", stagingKey: "seed/hero/", url: "/seed/hero/original.jpg",
          alt: "", decorative: false, focalX: 0.5, focalY: 0.5,
          variants: { original: "/seed/hero/original.jpg" }, seedPath: "hero",
        },
        overlayOpacity: heroOverlayOpacity,
        overlayDirection: "uniform", crossAlign: "start", ctas: [], contentAnchor: "block-center",
      },
      sections,
      social: [],
      footer: { legal: { copyrightYear: "auto" }, links: [] },
    },
    mustReplace: [],
  } as unknown as TemplatePreset;
}

describe("emitTemplate > cssBackgrounds resolution invariant", () => {
  it("blocks the emit when a cssBackgrounds path resolves to undefined", () => {
    const artifacts = importFixture();

    // "third" — the section that fell off the end under the old pathFor()
    // bug — has no backgroundImage in this preset.
    const preset = basePreset([section("first", true), section("second", true), section("third", false)]);

    const result = emitTemplate({
      templateId: "emit-blocker-test", templateVersion: "1.0.0",
      html: "", css: "", tokenize: artifacts.css, spec: artifacts.spec, preset,
      analysis: artifacts.analysis, merged: artifacts.merged, bundleAssets: [],
    });

    const blocker = result.blockers.find((b) => b.includes("cssBackgrounds"));
    expect(blocker).toBeDefined();
    expect(blocker).toContain("sections[2]");
  });

  it("does not block when every cssBackgrounds path resolves", () => {
    const artifacts = importFixture();
    const preset = basePreset([section("first", true), section("second", true), section("third", true)]);

    const result = emitTemplate({
      templateId: "emit-blocker-test", templateVersion: "1.0.0",
      html: "", css: "", tokenize: artifacts.css, spec: artifacts.spec, preset,
      analysis: artifacts.analysis, merged: artifacts.merged, bundleAssets: [],
    });

    expect(result.blockers.filter((b) => b.includes("cssBackgrounds"))).toEqual([]);
  });
});

// ============================================================================
// cssScrims resolution invariant — same shape as cssBackgrounds, above, for
// overlayOpacity instead of backgroundImage. A wrong sectionPath here is
// harder to notice than a missing image: it doesn't render nothing, it
// renders SOME section's opacity on the wrong element, silently.
// ============================================================================

describe("emitTemplate > cssScrims resolution invariant", () => {
  it("blocks the emit when a cssScrims path resolves to something other than a number", () => {
    const artifacts = importFixture();

    // "third" has no overlayOpacity in this preset (still the section()
    // default) — resolves to null, not a number.
    const preset = basePreset([
      section("first", true, 0.3),
      section("second", true, 0.3),
      section("third", true),
    ]);

    const result = emitTemplate({
      templateId: "emit-blocker-test", templateVersion: "1.0.0",
      html: "", css: "", tokenize: artifacts.css, spec: artifacts.spec, preset,
      analysis: artifacts.analysis, merged: artifacts.merged, bundleAssets: [],
    });

    const blocker = result.blockers.find((b) => b.includes("cssScrims"));
    expect(blocker).toBeDefined();
    expect(blocker).toContain("sections[2]");
  });

  it("does not block when every cssScrims path resolves to a number", () => {
    const artifacts = importFixture();
    const preset = basePreset([
      section("first", true, 0.3),
      section("second", true, 0.3),
      section("third", true, 0.3),
    ]);

    const result = emitTemplate({
      templateId: "emit-blocker-test", templateVersion: "1.0.0",
      html: "", css: "", tokenize: artifacts.css, spec: artifacts.spec, preset,
      analysis: artifacts.analysis, merged: artifacts.merged, bundleAssets: [],
    });

    expect(result.blockers.filter((b) => b.includes("cssScrims"))).toEqual([]);
  });
});
