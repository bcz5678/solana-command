// ============================================================================
// tools/template-import/__tests__/pipeline.test.ts
//
// Regression tests for two bugs in pipeline.ts:
//
//   bug 2 — buildSpecDraft() prefixed a repeater's selector/containerSelector
//           with the section's own scope, e.g. `${scope} ${repeater.selector}`.
//           detectRepeatersIn's selectors are already verified against the
//           whole document and complete on their own; prepending the scope
//           produced "#features #features" once a section's own container
//           could legitimately be the repeater's container (bug 1's fix made
//           that the common case, not a rare one).
//
//   bug 6 — applySectionOverrides forced confidence:1 on a section whenever
//           ANY override patch existed for it, even one that only set
//           ignoreRepeaters and never touched `type`. That silently dropped
//           the section from the "confirm type" review queue for a type
//           nobody had actually confirmed.
// ============================================================================

import { describe, it, expect } from "vitest";
import { runImport } from "../pipeline";
import { normalizeSource } from "../normalize";
import { CARD_GRID } from "../__fixtures__/index";

function importCardGrid(overrides?: Parameters<typeof runImport>[0]["overrides"]) {
  const { html, css } = normalizeSource(CARD_GRID);
  return runImport({ html, css, templateName: "card-grid", overrides });
}

describe("buildSpecDraft", () => {
  it("emits repeater selectors unprefixed by the section's own scope", () => {
    const artifacts = importCardGrid();
    const spec = artifacts.spec as { repeaters: Array<{ selector: string; containerSelector: string }> };

    expect(spec.repeaters).toHaveLength(1);
    const repeater = spec.repeaters[0]!;

    // The concrete failure mode: the container selector doubled on itself.
    expect(repeater.containerSelector).not.toContain("#features #features");
    expect(repeater.containerSelector).toBe("#features");
    expect(repeater.selector).toBe(".card");
  });
});

describe("applySectionOverrides", () => {
  it("only sets confidence:1 when the patch sets type", () => {
    const confirmedType = importCardGrid({
      sections: { features: { type: "cards" } },
    });
    const confirmed = confirmedType.analysis.sections.find((s) => s.sourceId === "features")!;
    expect(confirmed.confidence).toBe(1);

    const noReview = confirmedType.review.find((r) => r.at === 'sections["features"].type');
    expect(noReview).toBeUndefined();
  });

  it("leaves a section in the confirm queue when only ignoreRepeaters is set", () => {
    const withIgnoreRepeaters = importCardGrid({
      sections: { features: { ignoreRepeaters: true } },
    });
    const section = withIgnoreRepeaters.analysis.sections.find((s) => s.sourceId === "features")!;

    // The repeater really was suppressed...
    expect(section.repeaters).toHaveLength(0);
    // ...but the type was never confirmed, so confidence must not jump to 1...
    expect(section.confidence).toBeLessThan(1);
    // ...and the review queue must still ask a human to look at it.
    const item = withIgnoreRepeaters.review.find((r) => r.at === 'sections["features"].type');
    expect(item).toBeDefined();
    expect(item!.severity).toBe("confirm");
  });
});
