// ============================================================================
// tools/template-import/__tests__/merge.test.ts
//
// Regression test: pathFor() built cssBackgrounds' sectionPath from
// AnalyzedSection.order directly. order counts the hero section (hero=0,
// first real section=1, ...), but content.sections[] excludes the hero and
// restarts at 0 — so every non-hero section's cssBackground pointed at its
// NEXT sibling's content, and the last section's pointed past the end of the
// array entirely (resolvePath -> undefined -> no background at render time).
//
// Caught for real on spacex-ipo: three of four backgrounds were showing a
// neighboring section's image, and the fourth rendered none at all.
// ============================================================================

import { describe, it, expect } from "vitest";
import { runImport } from "../pipeline";
import { normalizeSource } from "../normalize";

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
`;

describe("merge > cssBackgrounds sectionPath (pathFor)", () => {
  it("indexes non-hero sections from 0, excluding the hero from the count", () => {
    const { html, css } = normalizeSource(`${HTML}<style>${CSS}</style>`);
    const artifacts = runImport({ html, css, templateName: "path-for-test" });

    const bySelector = new Map(
      artifacts.merged.cssBackgrounds.map((bg) => [bg.selector, bg.sectionPath]),
    );

    // selector carries the pseudo — matches what AssetRef.selector captures.
    // #hero is isHero: true and excluded from content.sections[] entirely —
    // "hero", not "sections[0]".
    expect(bySelector.get("#hero::before")).toBe("hero");
    // #first is content.sections[0], not sections[1] — this is the bug.
    expect(bySelector.get("#first::before")).toBe("sections[0]");
    expect(bySelector.get("#second::before")).toBe("sections[1]");
    // #third is content.sections[2] — previously "sections[3]", out of
    // bounds against a 3-entry array, which is exactly what produced
    // `background-image: none` on spacex-ipo.
    expect(bySelector.get("#third::before")).toBe("sections[2]");
  });
});

// ============================================================================
// cssScrims — real spacex-ipo shape: one shared scrim rule
// (".hero::after, .section::after") covering every section through classes,
// while each section also has its own unique id. A cssScrims entry keyed by
// the shared class selector would collide across sections (every section
// would paint the SAME per-site rule, unable to express a different opacity
// per section even though content.sections[].overlayOpacity is per-section)
// — that's why splitScrim derives `selector` from section.selector (unique)
// rather than the scrim rule's own selector text.
// ============================================================================

const SCRIM_HTML = `<!DOCTYPE html><html><head><title>t</title></head><body>
<section id="hero" class="hero"><h1>Hero</h1></section>
<section id="first" class="section"><h2>First</h2></section>
<section id="second" class="section"><h2>Second</h2></section>
</body></html>`;

const SCRIM_CSS = `
#hero::before{background-image:url('assets/hero.jpg')}
#first::before{background-image:url('assets/first.jpg')}
#second::before{background-image:url('assets/second.jpg')}
.hero::after,.section::after{background-color:rgba(0,0,0,.4)}
`;

describe("merge > cssScrims (splitScrim entries)", () => {
  it("gives each section its own unique selector, distinct from the shared source rule", () => {
    const { html, css } = normalizeSource(`${SCRIM_HTML}<style>${SCRIM_CSS}</style>`);
    const artifacts = runImport({ html, css, templateName: "scrim-test" });

    const bySelector = new Map(
      artifacts.merged.cssScrims.map((s) => [s.selector, s]),
    );

    expect(bySelector.get("#hero::after")).toEqual({
      sectionPath: "hero",
      selector: "#hero::after",
      sourceSelector: ".hero::after",
    });
    expect(bySelector.get("#first::after")).toEqual({
      sectionPath: "sections[0]",
      selector: "#first::after",
      sourceSelector: ".section::after",
    });
    expect(bySelector.get("#second::after")).toEqual({
      sectionPath: "sections[1]",
      selector: "#second::after",
      sourceSelector: ".section::after",
    });

    // Exactly one cssScrims entry per section, not per source rule — two
    // sections sharing ".section::after" must not collapse into one entry
    // (that would lose one section's ability to differ from the other).
    expect(artifacts.merged.cssScrims).toHaveLength(3);
  });

  it("attaches the parsed alpha to content, keyed per section", () => {
    const { html, css } = normalizeSource(`${SCRIM_HTML}<style>${SCRIM_CSS}</style>`);
    const artifacts = runImport({ html, css, templateName: "scrim-test-2" });

    const content = artifacts.merged.content as {
      hero: { overlayOpacity: number };
      sections: Array<{ overlayOpacity: number }>;
    };

    expect(content.hero.overlayOpacity).toBeCloseTo(0.4);
    expect(content.sections[0].overlayOpacity).toBeCloseTo(0.4);
    expect(content.sections[1].overlayOpacity).toBeCloseTo(0.4);
  });
});
