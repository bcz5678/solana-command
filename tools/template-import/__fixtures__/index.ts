// ============================================================================
// tools/template-import/__fixtures__/index.ts
//
// Checked-in source HTML for the import pipeline's tests. Unlike the renderer's
// GOLDEN/STRESS fixtures (site-platform/renderer/__fixtures__/index.ts), these
// are raw .html files, not typed objects — the pipeline's input IS markup, so
// the fixture has to be markup too.
//
//   CARD_GRID       — the fixture that surfaced the first two bugs found in this
//                      pipeline: a scoped-root repeater (three .card divs as a
//                      section's own direct children) and the doubled-selector
//                      bug that followed from fixing it. Also carries a
//                      leading-whitespace nav href and an unclosed hero <div>.
//
//   NESTED_SECTIONS  — richer coverage: a CSS-only (::before) hero background,
//                      a scrim split across theme colour + per-section alpha, a
//                      repeater whose fields are nested list items rather than
//                      direct children, a disallowed @import, a duplicate
//                      selector, a no-op :hover, and a media-query-scoped rule
//                      declared outside its media query too.
//
//   LEAF_REPEATER    — minimal, on purpose. A plain pill list (<span> siblings
//                      with no wrapping child element) is the case that used to
//                      make a whole repeater vanish with no trace: collectValues
//                      only ever walked INTO an item, so a leaf item's own text
//                      was invisible to it. See the `:scope` field selector.
//
//   SPACEX_IPO       — the real source this whole tool was built for. Carries
//                      properties no synthetic fixture reproduces faithfully:
//                      an unclosed <div class="content">, `href=" #ipo"` with
//                      leading whitespace, backgrounds that exist only as CSS
//                      (.starship::before etc., no <img> anywhere), a <script>
//                      block sitting AFTER </html>, a :hover identical to its
//                      base state, and an <h3> used exactly once — as a button
//                      label, not a heading — which is the case
//                      tokenize-css.ts's heading-usage exclusion exists for.
// ============================================================================

import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const DIR = dirname(fileURLToPath(import.meta.url));

function read(name: string): string {
  return readFileSync(join(DIR, name), "utf8");
}

export const CARD_GRID = read("card-grid.html");
export const NESTED_SECTIONS = read("nested-sections.html");
export const LEAF_REPEATER = read("leaf-repeater.html");
export const SPACEX_IPO = read("spacex-ipo.html");
