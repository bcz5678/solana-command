// ============================================================================
// scripts/detect-repeaters.ts
//
//   pnpm tsx scripts/detect-repeaters.ts path/to/index.html [--json] [--min 3]
//
// Prints the report, and with --json writes a draft `repeaters` array shaped
// for SlottedSpec. Correct the SPEC and re-run; never hand-edit extracted
// output, or the next run destroys the work.
// ============================================================================

import { readFileSync, writeFileSync } from "node:fs";
import { basename } from "node:path";
import { detectRepeaters, formatReport, type RepeaterCandidate } from
  "../tools/template-import/detect-repeaters.js";

const [file, ...flags] = process.argv.slice(2);

if (!file) {
  console.error("usage: detect-repeaters <file.html> [--json] [--min N]");
  process.exit(1);
}

const minIndex = flags.indexOf("--min");
const minRun = minIndex >= 0 ? Number(flags[minIndex + 1]) : 3;

const candidates = detectRepeaters(readFileSync(file, "utf8"), { minRun });
console.log(formatReport(candidates));

if (flags.includes("--json")) {
  const out = `${basename(file, ".html")}.repeaters.json`;
  writeFileSync(out, JSON.stringify(candidates.map(toDraftRepeater), null, 2));
  console.log(`Wrote ${out}\n`);
}

/**
 * Shape a candidate as a SlottedSpec repeater.
 *
 * `path` is left as a TODO placeholder rather than guessed: the mapping from a
 * detected region to a content path is the one decision that genuinely needs a
 * human, and a plausible-looking wrong guess is worse than a blank.
 *
 * Constant fields are emitted COMMENTED-OUT rather than dropped, so a reviewer
 * can see what was classified as chrome and disagree.
 */
function toDraftRepeater(candidate: RepeaterCandidate) {
  return {
    _hint: candidate.sectionTypeHint,
    _confidence: candidate.confidence,
    _notes: candidate.notes,
    _constantFields: candidate.fields
      .filter((f) => f.constant)
      .map((f) => ({ selector: f.selector, sample: f.samples[0] })),

    selector: candidate.selector,
    containerSelector: candidate.containerSelector,
    path: `TODO.${candidate.sectionTypeHint}`,
    max: Math.max(candidate.count * 2, 12),

    slots: candidate.fields
      .filter((f) => !f.constant)
      .map((f) => ({
        selector: f.selector,
        path: "TODO",
        mode: f.mode,
        note: [f.hint, f.optional ? "optional" : null]
          .filter(Boolean).join(" ") || undefined,
      })),
  };
}