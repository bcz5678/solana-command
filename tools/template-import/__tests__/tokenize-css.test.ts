// ============================================================================
// tools/template-import/__tests__/tokenize-css.test.ts
//
// neutralizeCoveredBackgrounds (fix #3). Covered backgrounds — ones with a
// per-site cssBackgrounds rule — get their background-image neutralized to
// `none` in SOURCE_CSS, since the per-site rule already wins the cascade.
// Orphans (no section match) must survive untouched: they're path-preserved
// into bundleAssets and have nothing else to supply the image.
//
// The failure mode this guards against is silent, not loud: a wrongly-keyed
// covered set doesn't throw, it just matches nothing and the "fix" does
// nothing. Every test here checks the CSS text, not just that the function
// returned without error.
// ============================================================================

import { describe, it, expect } from "vitest";
import { neutralizeCoveredBackgrounds, neutralizeCoveredScrims, rewriteCss, findUnrewritten, detectTokenCollisions, type Substitution } from "../css/tokenize-css";

const tokenToVar = (token: string) => `--st-${token.replace(/\./g, "-")}`;

const sub = (overrides: Partial<Substitution> & Pick<Substitution, "selector" | "property" | "token" | "original">): Substitution => ({
  confidence: 0.9,
  ...overrides,
});

describe("neutralizeCoveredBackgrounds", () => {
  it("neutralizes a covered selector keyed with its pseudo", () => {
    const css = `.starship::before{background-image:url(assets/img1.jpeg);background-size:cover}`;
    const covered = new Set([".starship::before"]);

    const result = neutralizeCoveredBackgrounds(css, covered);

    expect(result).toContain(".starship::before{background-image:none");
    expect(result).not.toContain("url(assets/img1.jpeg)");
    // Untouched declarations in the same rule survive.
    expect(result).toContain("background-size:cover");
  });

  it("does NOT neutralize when the covered set is keyed without the pseudo (the bug this guards)", () => {
    // selectorsOf() produces the full selector including the pseudo — a
    // covered set built from the bare selector (".starship", not
    // ".starship::before") is exactly the silent-no-op failure mode: it
    // doesn't throw, it just never matches.
    const css = `.starship::before{background-image:url(assets/img1.jpeg)}`;
    const covered = new Set([".starship"]);

    const result = neutralizeCoveredBackgrounds(css, covered);

    expect(result).toContain("url(assets/img1.jpeg)");
  });

  it("neutralizes a covered selector with no pseudo at all", () => {
    const css = `.hero{background-image:url(assets/banner.jpeg)}`;
    const covered = new Set([".hero"]);

    const result = neutralizeCoveredBackgrounds(css, covered);

    expect(result).toContain(".hero{background-image:none}");
  });

  it("leaves an orphan background — absent from the covered set — untouched", () => {
    // Same shape as a real orphan: a selector with a real background-image
    // that never made it into cssBackgrounds because it matched no section.
    // The covered set here mirrors what emit.ts builds it from (cssBackgrounds
    // only) — this asserts the exclusion rather than assuming it holds.
    const css = [
      `.starship::before{background-image:url(assets/img1.jpeg)}`,
      `.decorative::before{background-image:url(assets/texture.png)}`,
    ].join("");
    const covered = new Set([".starship::before"]); // orphan (.decorative) absent

    const result = neutralizeCoveredBackgrounds(css, covered);

    expect(result).toContain(".starship::before{background-image:none}");
    expect(result).toContain("url(assets/texture.png)"); // orphan survives
  });

  it("leaves every other declaration and rule in the stylesheet untouched", () => {
    const css = `h1{color:red}.starship::before{background-image:url(assets/img1.jpeg);background-position:50% 50%}`;
    const covered = new Set([".starship::before"]);

    const result = neutralizeCoveredBackgrounds(css, covered);

    expect(result).toContain("h1{color:red}");
    expect(result).toContain("background-position:50% 50%");
  });

  it("is a no-op on an empty covered set", () => {
    const css = `.starship::before{background-image:url(assets/img1.jpeg)}`;
    const result = neutralizeCoveredBackgrounds(css, new Set());
    expect(result).toContain("url(assets/img1.jpeg)");
  });
});

// ============================================================================
// rewriteCss — shorthand-derived substitutions
//
// classify() (tokenizeCss) expands `background`/`border`/`padding` shorthand
// into longhands before matching the rule table, so a substitution can be
// keyed under a property name (`background-color`) that never appears in the
// source verbatim. Real regression: 13 substitutions on spacex-ipo were
// classified this way and NEVER rewritten, because rewriteCss looked
// declarations up by the raw, unexpanded property straight off the AST.
// ============================================================================

describe("rewriteCss — shorthand", () => {
  it("rewrites a pure-color background shorthand to background-color, dropping the shorthand", () => {
    const css = `body{background:#000}`;
    const subs = [sub({ selector: "body", property: "background-color", token: "core.colors.background", original: "#000" })];

    const result = rewriteCss(css, subs, tokenToVar);

    expect(result).toContain("background-color:var(--st-core-colors-background, #000)");
    expect(result).not.toMatch(/body\{background:/);
  });

  it("splits a 2-value padding shorthand into padding-block and padding-inline", () => {
    const css = `.hero{padding:80px 8%}`;
    const subs = [
      sub({ selector: ".hero", property: "padding-block", token: "core.spacing.sectionPaddingBlock", original: "80px" }),
      sub({ selector: ".hero", property: "padding-inline", token: "core.spacing.sectionPaddingInline", original: "8%" }),
    ];

    const result = rewriteCss(css, subs, tokenToVar);

    expect(result).toContain("padding-block:var(--st-core-spacing-sectionPaddingBlock, 80px)");
    expect(result).toContain("padding-inline:var(--st-core-spacing-sectionPaddingInline, 8%)");
    expect(result).not.toMatch(/\.hero\{padding:/);
  });

  it("preserves an untokenized part of a fully-accounted shorthand as a literal longhand", () => {
    // Only padding-block has a rule for this selector; padding-inline must
    // still end up in the output with its original value, not be dropped.
    const css = `.nav-links{padding:1rem 2rem}`;
    const subs = [sub({ selector: ".nav-links", property: "padding-block", token: "templates.$.x", original: "1rem" })];

    const result = rewriteCss(css, subs, tokenToVar);

    expect(result).toContain("padding-block:var(--st-templates-$-x, 1rem)");
    expect(result).toContain("padding-inline:2rem");
  });

  it("leaves a border shorthand untouched — width and style have nowhere to go", () => {
    // expand() only ever captures the color out of `border`. Rewriting this
    // in place to `border-color: var(...)` would silently delete the width
    // and style, making the border disappear. It must stay exactly as
    // authored, and the substitution stays unapplied — findUnrewritten is
    // what's supposed to catch that, not this function pretending it's safe.
    const css = `.btn{border:2px solid #fff}`;
    const subs = [sub({ selector: ".btn", property: "border-color", token: "core.colors.primary", original: "#fff" })];

    const result = rewriteCss(css, subs, tokenToVar);

    expect(result).toBe(".btn{border:2px solid #fff}");
  });

  it("leaves a border-top shorthand untouched for the same reason", () => {
    const css = `footer{border-top:1px solid #222}`;
    const subs = [sub({ selector: "footer", property: "border-top-color", token: "semantic.footerBorder", original: "#222" })];

    const result = rewriteCss(css, subs, tokenToVar);

    expect(result).toBe("footer{border-top:1px solid #222}");
  });

  it("still rewrites an already-longhand declaration exactly as before", () => {
    const css = `.btn{background-color:#4de3c4}`;
    const subs = [sub({ selector: ".btn", property: "background-color", token: "core.colors.primary", original: "#4de3c4" })];

    const result = rewriteCss(css, subs, tokenToVar);

    expect(result).toContain("background-color:var(--st-core-colors-primary, #4de3c4)");
  });
});

describe("findUnrewritten", () => {
  it("reports nothing once rewriteCss applies every substitution", () => {
    const css = `body{background:#000}`;
    const subs = [sub({ selector: "body", property: "background-color", token: "core.colors.background", original: "#000" })];

    const rewritten = rewriteCss(css, subs, tokenToVar);

    expect(findUnrewritten(rewritten, subs)).toEqual([]);
  });

  it("reports the two known-unrewritable border substitutions from the real spacex-ipo shape", () => {
    const css = `.btn{border:2px solid #fff}footer{border-top:1px solid #222}`;
    const subs = [
      sub({ selector: ".btn", property: "border-color", token: "core.colors.primary", original: "#fff" }),
      sub({ selector: "footer", property: "border-top-color", token: "semantic.footerBorder", original: "#222" }),
    ];

    const rewritten = rewriteCss(css, subs, tokenToVar);

    expect(findUnrewritten(rewritten, subs)).toEqual(subs);
  });

  it("does not flag a substitution rewriteCss legitimately applied under a different property name", () => {
    const css = `.hero{padding:80px 8%}`;
    const subs = [
      sub({ selector: ".hero", property: "padding-block", token: "core.spacing.sectionPaddingBlock", original: "80px" }),
      sub({ selector: ".hero", property: "padding-inline", token: "core.spacing.sectionPaddingInline", original: "8%" }),
    ];

    const rewritten = rewriteCss(css, subs, tokenToVar);

    expect(findUnrewritten(rewritten, subs)).toEqual([]);
  });

  it("does not flag an exempt token even though rewriteCss never applied it", () => {
    // The scrim shape: neutralizeCoveredScrims deliberately strips the
    // rewritten var() back out to `transparent`, because the real value
    // comes from a per-site color-mix() rule instead. Without the exemption
    // this would report a false regression on every single run.
    const css = `.hero::after{background-color:transparent}`;
    const subs = [sub({ selector: ".hero::after", property: "background-color", token: "core.colors.overlay", original: "rgba(0,0,0,.4)" })];

    expect(findUnrewritten(css, subs, new Set(["core.colors.overlay"]))).toEqual([]);
  });

  it("still flags an exempt-token selector if the exempt set doesn't name it", () => {
    // Exemption is by token, not blanket — a DIFFERENT unresolved token at
    // the same selector must still surface.
    const css = `.hero::after{background-color:transparent}`;
    const subs = [sub({ selector: ".hero::after", property: "background-color", token: "core.colors.overlay", original: "rgba(0,0,0,.4)" })];

    expect(findUnrewritten(css, subs, new Set(["some.other.token"]))).toEqual(subs);
  });
});

// ============================================================================
// neutralizeCoveredScrims — the scrim analogue of neutralizeCoveredBackgrounds.
// A covered scrim's background-color becomes dead weight once the per-site
// color-mix() rule is authoritative for its selector — neutralized to
// `transparent` rather than left as a flat, alpha-less var() fallback that
// only ever wins by cascade accident.
// ============================================================================

describe("neutralizeCoveredScrims", () => {
  it("neutralizes a covered scrim selector to transparent", () => {
    const css = `.hero::after{content:"";background-color:rgba(0,0,0,.4)}`;
    const covered = new Set([".hero::after"]);

    const result = neutralizeCoveredScrims(css, covered);

    expect(result).toContain(".hero::after{content:\"\";background-color:transparent}");
  });

  it("does NOT neutralize when the covered set is keyed without the pseudo (the bug this guards)", () => {
    const css = `.hero::after{background-color:rgba(0,0,0,.4)}`;
    const covered = new Set([".hero"]);

    const result = neutralizeCoveredScrims(css, covered);

    expect(result).toContain("rgba(0,0,0,.4)");
  });

  it("leaves an uncovered (orphan) scrim untouched", () => {
    const css = [
      `.hero::after{background-color:rgba(0,0,0,.4)}`,
      `.decorative::after{background-color:rgba(0,0,0,.2)}`,
    ].join("");
    const covered = new Set([".hero::after"]);

    const result = neutralizeCoveredScrims(css, covered);

    expect(result).toContain(".hero::after{background-color:transparent}");
    expect(result).toContain("rgba(0,0,0,.2)");
  });

  it("only touches background-color, leaving background-image alone", () => {
    const css = `.hero::before{background-image:url(x.jpg);background-color:rgba(0,0,0,.4)}`;
    const covered = new Set([".hero::before"]);

    const result = neutralizeCoveredScrims(css, covered);

    expect(result).toContain("background-image:url(x.jpg)");
    expect(result).toContain("background-color:transparent");
  });

  it("is a no-op on an empty covered set", () => {
    const css = `.hero::after{background-color:rgba(0,0,0,.4)}`;
    const result = neutralizeCoveredScrims(css, new Set());
    expect(result).toContain("rgba(0,0,0,.4)");
  });
});

// ============================================================================
// detectTokenCollisions
//
// buildThemeDraft folds substitutions into the theme draft with a
// last-write-wins loop, keyed by token — two declarations mapping to the
// same token with different values resolve by stylesheet order and nothing
// says so. Real case: h1{line-height:1.05} and h2{line-height:1.1} both map
// to core.typography.lineHeightHeading; which one survived depended on which
// rule happened to come later in the source, and that stayed invisible until
// verify's computed-style diff caught the LOSING value rendering wrong.
// ============================================================================

describe("detectTokenCollisions", () => {
  it("flags two substitutions writing the same token with different values", () => {
    const subs = [
      sub({ selector: "h1", property: "line-height", token: "core.typography.lineHeightHeading", original: "1.05" }),
      sub({ selector: "h2", property: "line-height", token: "core.typography.lineHeightHeading", original: "1.1" }),
    ];

    const findings = detectTokenCollisions(subs);

    expect(findings).toHaveLength(1);
    expect(findings[0]).toContain("core.typography.lineHeightHeading");
    expect(findings[0]).toContain("h1 { line-height: 1.05 }");
    expect(findings[0]).toContain("h2 { line-height: 1.1 }");
    // Last in array order is what setPath actually leaves standing.
    expect(findings[0]).toContain('"1.1" (h2) was kept');
  });

  it("does not flag the same token written twice with the identical value", () => {
    // A legitimate collapse — three arbitrary letter-spacing values reducing
    // to one token is normal and not a bug.
    const subs = [
      sub({ selector: ".kicker", property: "letter-spacing", token: "core.typography.letterSpacingWide", original: "2px" }),
      sub({ selector: ".logo", property: "letter-spacing", token: "core.typography.letterSpacingWide", original: "2px" }),
    ];

    expect(detectTokenCollisions(subs)).toEqual([]);
  });

  it("does not flag a single substitution for a token", () => {
    const subs = [sub({ selector: "h1", property: "line-height", token: "core.typography.lineHeightHeading", original: "1.05" })];
    expect(detectTokenCollisions(subs)).toEqual([]);
  });

  it("does not flag different tokens even with differing values", () => {
    const subs = [
      sub({ selector: "body", property: "background-color", token: "core.colors.background", original: "#000" }),
      sub({ selector: ".btn", property: "background-color", token: "core.colors.primary", original: "#fff" }),
    ];

    expect(detectTokenCollisions(subs)).toEqual([]);
  });

  it("excludes a media-scoped substitution for a non-MOBILE_SCOPED token — it never competes, buildThemeDraft never writes it", () => {
    const subs = [
      sub({ selector: "h1", property: "line-height", token: "core.typography.lineHeightHeading", original: "1.05" }),
      sub({ selector: "h1", property: "line-height", token: "core.typography.lineHeightHeading", original: "1.3", media: "(max-width: 768px)" }),
    ];

    expect(detectTokenCollisions(subs)).toEqual([]);
  });

  it("includes a media-scoped substitution for a MOBILE_SCOPED token — it does compete", () => {
    const subs = [
      sub({ selector: ".nav-links", property: "background-color", token: "semantic.mobileMenuBackground", original: "#111" }),
      sub({ selector: ".nav-links.active", property: "background-color", token: "semantic.mobileMenuBackground", original: "#222", media: "(max-width: 768px)" }),
    ];

    expect(detectTokenCollisions(subs)).toHaveLength(1);
  });

  it("names every competing declaration, not just the first and last, when three or more collide", () => {
    const subs = [
      sub({ selector: "h1", property: "line-height", token: "core.typography.lineHeightHeading", original: "1.05" }),
      sub({ selector: "h2", property: "line-height", token: "core.typography.lineHeightHeading", original: "1.1" }),
      sub({ selector: "h3", property: "line-height", token: "core.typography.lineHeightHeading", original: "1.15" }),
    ];

    const [finding] = detectTokenCollisions(subs);
    expect(finding).toContain("h1 { line-height: 1.05 }");
    expect(finding).toContain("h2 { line-height: 1.1 }");
    expect(finding).toContain("h3 { line-height: 1.15 }");
    expect(finding).toContain('"1.15" (h3) was kept');
  });
});
