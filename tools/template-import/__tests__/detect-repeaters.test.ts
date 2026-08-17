// ============================================================================
// tools/template-import/__tests__/detect-repeaters.test.ts
//
// Regression test for bug 1: detectRepeatersIn scoped to a section never
// checked the section's OWN direct children for repetition, because walk()
// is deliberately descendants-only (correct for the old whole-document entry
// point, wrong once analyze.ts started scoping the call per-section — a
// section's own direct children being the repeating group is the common
// case, not an edge case). Fixed by iterating [root, ...walk(root)].
// ============================================================================

import { describe, it, expect } from "vitest";
import { parseHTML } from "linkedom";
import { detectRepeatersIn } from "../detect-repeaters";
import type { El } from "../dom";
import { CARD_GRID } from "../__fixtures__/index";

describe("detectRepeatersIn", () => {
  it("finds a repeater whose items are the scoped root's own direct children", () => {
    const { document } = parseHTML(CARD_GRID);
    const doc = document as unknown as El;
    const section = doc.querySelector("#features")!;

    const repeaters = detectRepeatersIn(section, doc);

    // If walk() regressed to descendants-only with root excluded, the three
    // .card divs — the section's own children — are invisible: nothing beneath
    // them (a bare h3, a bare p) has children of its own to group, so this
    // list would be empty rather than containing the card repeater.
    expect(repeaters).toHaveLength(1);
    expect(repeaters[0]!.containerSelector).toBe("#features");
    expect(repeaters[0]!.count).toBe(3);
    expect(repeaters[0]!.selector).toBe(".card");
  });
});
