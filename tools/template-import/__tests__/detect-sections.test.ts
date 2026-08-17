// ============================================================================
// tools/template-import/__tests__/detect-sections.test.ts
//
// readRoles(section, excluded) must resolve roles as if repeater items were
// never there. If a card's <h3> reaches it, that heading becomes the
// section's "title" and kicker detection — "short leaf text before the
// heading" — is computed against ITS index, not the real heading's. Filtering
// duplicates out afterwards would remove the bad title but leave the kicker
// wrong, which is why exclusion has to happen up front (see the docstring on
// readRoles).
//
// The section's own heading is placed AFTER the repeater on purpose: with the
// cards excluded, the kicker is still the first leaf before the (real) heading
// and the title is the section's own <h2>; without exclusion, the first
// heading found is card one's <h3> instead, which is the exact failure the
// docstring describes.
// ============================================================================

import { describe, it, expect } from "vitest";
import { parseHTML } from "linkedom";
import { readRoles } from "../detect-sections";
import { detectRepeatersIn } from "../detect-repeaters";
import type { El } from "../dom";

// The kicker is a <div>, not a <p>: readRoles treats every <p> as body copy
// unconditionally, before the kicker branch ever runs, so a <p class="kicker">
// (common in real markup — see spacex-ipo.html) never resolves as a kicker at
// all. That's a separate, pre-existing gap from the one under test here.
const HTML = `
<section id="features">
  <div class="kicker">Why us</div>
  <div class="card"><h3>Card One</h3><p>One</p></div>
  <div class="card"><h3>Card Two</h3><p>Two</p></div>
  <div class="card"><h3>Card Three</h3><p>Three</p></div>
  <h2>Features</h2>
</section>
`;

describe("readRoles", () => {
  it("excludes repeater items — a card's <h3> is not the section title, and the section's real kicker still resolves", () => {
    const { document } = parseHTML(HTML);
    const doc = document as unknown as El;
    const section = doc.querySelector("#features")!;

    const repeaters = detectRepeatersIn(section, doc);
    const items = repeaters.flatMap((r) => Array.from(doc.querySelectorAll(r.selector)));

    // Sanity: the repeater was actually found, so the assertions below are
    // exercising exclusion and not just an empty items list.
    expect(items).toHaveLength(3);

    const withExclusion = readRoles(section, items);
    expect(withExclusion.title).toBe("h2");
    expect(withExclusion.kicker).toBe(".kicker");

    // Simulates the pre-fix call site (no exclusion list), proving the
    // assertions above actually depend on `excluded` rather than some other
    // mechanism: without it, the first card's own <h3> is mistaken for the
    // section's title.
    const withoutExclusion = readRoles(section, []);
    expect(withoutExclusion.title).toBe(".card h3");
  });
});
