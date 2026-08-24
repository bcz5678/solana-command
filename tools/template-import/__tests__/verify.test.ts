// ============================================================================
// tools/template-import/__tests__/verify.test.ts
//
// Both checks are pure functions, tested directly without a browser — the
// thing under test is the classification/parsing logic, not Playwright.
//
//   backgroundIdentityRule       — "changed to some /media/-shaped value" vs
//                                   "changed to THIS value" for cssBackgrounds.
//                                   Real bug: three of spacex-ipo's four
//                                   backgrounds pointed at a neighboring
//                                   section's image, and every one of them was
//                                   a well-formed, non-"none" URL — the old
//                                   loose check couldn't tell.
//
//   checkTokenizationCoverage    — computed-value diffing can't see a
//                                   substitution that never made it into the
//                                   rendered CSS at all: the source's own
//                                   literal survives untouched, which
//                                   trivially equals the source and produces
//                                   no difference to classify. Real case:
//                                   spacex-ipo's heading font-size.
// ============================================================================

import { describe, it, expect } from "vitest";
import { backgroundIdentityRule, checkTokenizationCoverage, normalize, type Difference } from "../verify";
import type { Substitution } from "../css/tokenize-css";

function diff(overrides: Partial<Difference> = {}): Difference {
  return {
    selector: ".starship",
    pseudo: "before",
    index: 0,
    property: "background-image",
    source: `url("assets/img1.jpeg")`,
    // getComputedStyle() resolves a root-relative url() to absolute against
    // the page's own origin — this is the shape a real Playwright probe
    // actually returns, not a bare path.
    rendered: `url("https://example.test/media/section-2400.abc123.webp")`,
    classification: "unexpected",
    ...overrides,
  };
}

describe("backgroundIdentityRule", () => {
  it("classifies expected when the computed URL resolves to the independently-derived one", () => {
    const rule = backgroundIdentityRule(new Map([[".starship::before", "/media/section-2400.abc123.webp"]]));
    expect(rule.when!(diff())).toBe(true);
  });

  it("classifies unexpected when the computed URL is well-formed but WRONG — the off-by-one signature", () => {
    // Exactly what shipped: a real, non-"none" /media/ URL that belonged to
    // a different section. The old rule (rendered !== "none") called this
    // expected; this one must not.
    const rule = backgroundIdentityRule(new Map([[".starship::before", "/media/section-2400.abc123.webp"]]));
    const wrong = diff({ rendered: `url("https://example.test/media/section-2400.WRONG999.webp")` });
    expect(rule.when!(wrong)).toBe(false);
  });

  it("defers to the baseline rule (returns false) when the selector has no tracked expectation", () => {
    // e.g. expectedBackgroundUrls was built from a manifest that doesn't
    // cover this selector at all — not every background-image diff is a
    // cssBackgrounds target.
    const rule = backgroundIdentityRule(new Map([[".human::before", "/media/x.webp"]]));
    expect(rule.when!(diff({ selector: ".starship" }))).toBe(false);
  });
});

describe("checkTokenizationCoverage", () => {
  const substitutions: Substitution[] = [
    { selector: "p", property: "letter-spacing", token: "core.typography.letterSpacingWide", original: "1px", confidence: 1 },
    { selector: "h1", property: "font-size", token: "core.typography.baseFontSize", original: "72px", confidence: 1 },
  ];

  it("reports nothing missing when every substitution appears as var(--st-...)", () => {
    const html = `<html><head><style>p{letter-spacing:var(--st-letter-spacing-wide, 1px)}h1{font-size:var(--st-font-size-h1, 72px)}</style></head></html>`;
    expect(checkTokenizationCoverage(html, substitutions)).toEqual([]);
  });

  it("reports a substitution whose declaration exists but was never rewritten to var() — the real spacex-ipo shape", () => {
    // h1's font-size stayed a hardcoded literal; nothing in the slotted path
    // ever wires --st-font-size-h1 to it, even though the token block
    // declares one.
    const html = `<html><head><style>p{letter-spacing:var(--st-letter-spacing-wide, 1px)}h1{font-size:72px}</style></head></html>`;
    expect(checkTokenizationCoverage(html, substitutions)).toEqual([
      { selector: "h1", property: "font-size", token: "core.typography.baseFontSize" },
    ]);
  });

  it("reports a substitution with no matching declaration in the rendered CSS at all", () => {
    const html = `<html><head><style>h1{font-size:var(--st-font-size-h1, 72px)}</style></head></html>`;
    expect(checkTokenizationCoverage(html, substitutions)).toEqual([
      { selector: "p", property: "letter-spacing", token: "core.typography.letterSpacingWide" },
    ]);
  });
});

// ============================================================================
// normalize — color(srgb …) vs rgba()
//
// A scrim's per-site rule resolves through color-mix(), and Chromium's
// getComputedStyle serializes a color-mix() result as CSS Color 4's
// `color(srgb r g b / a)` rather than `rgb()`/`rgba()` — same colour,
// different function. Real bug this normalization fixes: after the scrim
// opacity fix landed, every one of spacex-ipo's four scrims read as
// "unexpected" (source `rgba(0, 0, 0, 0.35)` vs rendered
// `color(srgb 0 0 0 / 0.35)`) despite being numerically identical.
// ============================================================================

describe("normalize", () => {
  it("converts color(srgb r g b / a) to the equivalent rgba(), 0-1 fractions to 0-255 integers", () => {
    expect(normalize("color(srgb 0 0 0 / 0.35)")).toBe(normalize("rgba(0, 0, 0, 0.35)"));
  });

  it("converts color(srgb r g b) with no alpha to rgb()", () => {
    expect(normalize("color(srgb 1 1 1)")).toBe(normalize("rgb(255, 255, 255)"));
  });

  it("rounds fractional channel values to the nearest 0-255 integer", () => {
    // 0.35 * 255 = 89.25 -> 89, matching how a browser would round the same
    // underlying colour if it had serialized as rgb() instead.
    expect(normalize("color(srgb 0.35 0.35 0.35 / 1)")).toBe(normalize("rgb(89, 89, 89)"));
  });

  it("leaves an ordinary rgba() value untouched other than the existing alpha-1 collapse", () => {
    expect(normalize("rgba(12, 34, 56, 0.5)")).toBe("rgba(12, 34, 56, 0.5)");
  });
});
