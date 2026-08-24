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

// ============================================================================
// Token collision findings (detectTokenCollisions, tokenize-css.ts)
//
// Real case: h1{line-height:1.05} and h2{line-height:1.1} both map to
// core.typography.lineHeightHeading. Which one survives buildThemeDraft's
// last-write-wins loop depends on stylesheet order, and until this finding
// existed nothing said so — it stayed invisible until verify's computed-style
// diff caught the losing value rendering wrong, several steps later than
// analyze, where the same fact was already knowable.
// ============================================================================

const COLLISION_HTML = `<!DOCTYPE html><html><head><title>t</title></head><body>
<section id="hero"><h1>Hero</h1><h2>Sub</h2></section>
</body></html>`;

const COLLISION_CSS = `h1{line-height:1.05}h2{line-height:1.1}`;

function importCollisionFixture(overrides?: Parameters<typeof runImport>[0]["overrides"]) {
  const { html, css } = normalizeSource(`${COLLISION_HTML}<style>${COLLISION_CSS}</style>`);
  return runImport({ html, css, templateName: "collision-test", overrides });
}

describe("detectTokenCollisions (via runImport)", () => {
  it("surfaces a colliding token as a css finding AND a review note, at analyze time", () => {
    const artifacts = importCollisionFixture();

    const finding = artifacts.css.findings.find((f) => f.includes("core.typography.lineHeightHeading"));
    expect(finding).toBeDefined();
    expect(finding).toContain("h1 { line-height: 1.05 }");
    expect(finding).toContain("h2 { line-height: 1.1 }");

    // buildReview folds every css.findings entry into a review item — this is
    // what makes it visible during `analyze`/`check`, not only at `verify`.
    const reviewItem = artifacts.review.find(
      (r) => r.at === "substitutions" && r.message.includes("core.typography.lineHeightHeading"),
    );
    expect(reviewItem).toBeDefined();
    expect(reviewItem!.severity).toBe("note");
  });

  it("clears the stale collision finding once a retoken override resolves it, without leaving a duplicate", () => {
    const resolved = importCollisionFixture({
      substitutions: { retoken: { "h1|line-height": "templates.$.h1LineHeight" } },
    });

    // h1 no longer competes for core.typography.lineHeightHeading — h2 is the
    // only substitution left on that token, so there's nothing to collide with.
    const stale = resolved.css.findings.find((f) => f.includes("core.typography.lineHeightHeading"));
    expect(stale).toBeUndefined();

    // And no finding invents a NEW collision for h1's new token either — it's
    // the only substitution mapped to templates.$.h1LineHeight.
    const newCollision = resolved.css.findings.find((f) => f.includes("templates.$.h1LineHeight"));
    expect(newCollision).toBeUndefined();
  });

  it("does not clear the finding when the retoken leaves the collision in place", () => {
    // Retokenizes something unrelated — h1/h2 line-height still collide.
    const stillColliding = importCollisionFixture({
      substitutions: { retoken: { "h1|line-height": "core.typography.lineHeightHeading" } },
    });

    const finding = stillColliding.css.findings.find((f) => f.includes("core.typography.lineHeightHeading"));
    expect(finding).toBeDefined();
  });
});
