// ============================================================================
// scripts/import-template.ts
//
//   pnpm import-template init    <file.html> <template-id>
//   pnpm import-template analyze <template-dir>
//   pnpm import-template check   <template-dir>      # CI, no writes
//
// Not yet implemented — the stages that follow review:
//   assets  <dir>   download source images, generate variants, upload to seed
//   preset  <dir>   mint ids, assign slugs, parse PresetContentSchema
//   emit    <dir>   rewriteCss, hash, write manifest
//   verify  <dir>   render the preset, diff against source.html
//
// ---------------------------------------------------------------------------
// WORKING DIRECTORY — the unit of state. Flags don't accumulate across stages;
// the directory does.
//
//   templates/{id}/
//     source.html          input, read-only after init
//     source.css           extracted from <style> and/or linked sheets
//     overrides.json       THE ONLY AUTHORED FILE — never written by this tool
//     .generated/          always safe to delete
//       analysis.json      machine-readable, for a future review UI
//       spec.draft.json    selectors  -> SlottedSpec
//       content.draft.json values     -> preset content
//       theme.draft.json   values     -> LayeredTheme
//       IMPORT_REPORT.md   the review queue
//
// The authored/generated split is what makes "correct and re-run" safe. Editing
// a draft is always wrong; the next run overwrites it.
// ============================================================================

import { readFileSync, writeFileSync, mkdirSync, existsSync, rmSync } from "node:fs";
import { join, basename } from "node:path";
import { parseHTML } from "linkedom";
import { normalizeSource } from "../tools/template-import/normalize";


import { authorPreset } from "../tools/template-import/author-preset";
import { runImport, type Overrides, type ImportArtifacts, type ReviewItem } from '../tools/template-import/pipeline'

const EXIT = { ok: 0, usage: 1, failed: 2 } as const;0

const [command, ...args] = process.argv.slice(2);

switch (command) {
  case "init":    init(args[0], args[1]); break;
  case "analyze": analyzeDir(args[0], { write: true }); break;
  case "check":   checkDir(args[0]); break;

  case "assets":  presetDir(args[0]); break;
  case "preset":
  case "emit":
  case "verify":
    console.error(`"${command}" is not implemented yet.`);
    process.exit(EXIT.usage);
    break;

  default:
    console.error(
      "usage:\n" +
      "  import-template init    <file.html> <template-id>\n" +
      "  import-template analyze <template-dir>\n" +
      "  import-template check   <template-dir>",
    );
    process.exit(EXIT.usage);
}




// ============================================================================
// INIT
// ============================================================================

/**
 * Create the working directory and split the source.
 *
 * Extracting <style> to source.css is not cosmetic: both passes want a clean
 * single input, and a stylesheet that stays inline can't be diffed after
 * rewriting.
 */
function init(file: string, id: string): void {
  if (!file || !id) {
    console.error("usage: import-template init <file.html> <template-id>");
    process.exit(EXIT.usage);
  }

  const dir = join("templates", id);
  if (existsSync(dir)) {
    console.error(`${dir} already exists — delete it or pick another id.`);
    process.exit(EXIT.usage);
  }

  mkdirSync(dir, { recursive: true });

  const raw = readFileSync(file, "utf8");
  const result = normalizeSource(raw);

  // Verbatim, and never read by the pipeline. It exists so step 9 diffs
  // against the page we claim to reproduce rather than against our own repair
  // of it — the parser closes unclosed tags, and that changes the tree.
  writeFileSync(join(dir, "source.original.html"), raw);

  // Normalized, with <style> blocks removed. Everything downstream reads this,
  // and sourceHash is computed over it.
  writeFileSync(join(dir, "source.html"), result.html);
  writeFileSync(join(dir, "source.css"), result.css);

  // Authored once, then never written by this tool again.
  writeFileSync(
    join(dir, "overrides.json"),
    `${JSON.stringify({ sections: {}, substitutions: {}, anonymize: {} }, null, 2)}\n`,
  );

  console.log(`Initialized ${dir} from ${basename(file)}`);

  for (const change of result.changes) console.log(`  · ${change}`);
  for (const warning of result.warnings) console.log(`  ! ${warning}`);
}



// ============================================================================
// ANALYZE
// ============================================================================

function analyzeDir(dir: string, options: { write: boolean }): ImportArtifacts {
  if (!dir) {
    console.error("usage: import-template analyze <template-dir>");
    process.exit(EXIT.usage);
  }

  const html = read(dir, "source.html");
  const css = read(dir, "source.css");
  const overrides = readOverrides(dir);

  const artifacts = runImport({ html, css, overrides, templateName: basename(dir) });

  if (options.write) {
    const generated = join(dir, ".generated");

    // Blown away rather than merged. Stale drafts from a previous shape are
    // worse than missing ones.
    rmSync(generated, { recursive: true, force: true });
    mkdirSync(generated, { recursive: true });

    write(generated, "analysis.json", artifacts.analysis);
    write(generated, "spec.draft.json", artifacts.spec);
    write(generated, "content.draft.json", artifacts.merged.content);
    write(generated, "theme.draft.json", artifacts.merged.theme);
    writeFileSync(join(generated, "IMPORT_REPORT.md"), report(dir, artifacts));

    console.log(`Wrote ${generated}/`);
  }

  console.log(summary(artifacts));
  return artifacts;
}

// ============================================================================
// CHECK
// ============================================================================

/**
 * CI mode. Writes nothing, exits non-zero on anything a human still owes.
 *
 * The blocker that always fires until addressed is anonymisation — a preset
 * ships to every site created from the template.
 */
function checkDir(dir: string): void {
  const artifacts = analyzeDir(dir, { write: false });
  const blockers = artifacts.review.filter((r) => r.severity === "blocker");

  const todos = JSON.stringify(artifacts.spec).match(/"TODO/g)?.length ?? 0;

  if (blockers.length === 0 && todos === 0) {
    console.log("OK");
    process.exit(EXIT.ok);
  }

  for (const item of blockers) console.error(`BLOCKER  ${item.at}  ${item.message}`);
  if (todos > 0) console.error(`BLOCKER  spec  ${todos} unresolved TODO path(s).`);

  process.exit(EXIT.failed);
}

// ============================================================================
// PRESET
// ============================================================================

/**
 * Step 7. Unlike `analyze`, this writes OUTSIDE the working directory and into
 * the template package, and the result is meant to be edited by hand
 * afterwards — so it refuses to clobber rather than regenerating silently.
 */
function presetDir(dir: string): void {
  if (!dir) {
    console.error("usage: import-template preset <template-dir>");
    process.exit(EXIT.usage);
  }

  const templateId = basename(dir);
  const presetId = "original";

  const outDir = join("site-platform/renderer/templates", templateId, "presets");
  const outFile = join(outDir, `${presetId}.ts`);

  if (existsSync(outFile)) {
    console.error(
      `${outFile} already exists.\n` +
      `Presets are hand-edited after generation — delete it deliberately if you\n` +
      `want to regenerate, or pass a different preset id.`,
    );
    process.exit(EXIT.usage);
  }

  const { preset, source, warnings } = authorPreset({
    templateId,
    templateVersion: "1.0.0",
    presetId,
    presetName: "Original",
    themeDraft: json(dir, ".generated/theme.draft.json"),
    contentDraft: json(dir, ".generated/content.draft.json"),
    html: read(dir, "source.html"),
    overrides: readOverrides(dir),
  });

  mkdirSync(outDir, { recursive: true });
  writeFileSync(outFile, source);

  console.log(`Wrote ${outFile}`);
  console.log(`  ${preset.content.sections.length} sections, ${preset.mustReplace.length} mustReplace paths`);

  for (const warning of warnings) console.log(`  ! ${warning}`);
}

// ============================================================================
// OUTPUT
// ============================================================================

function summary(artifacts: ImportArtifacts): string {
  const counts = artifacts.review.reduce<Record<string, number>>(
    (acc, item) => ({ ...acc, [item.severity]: (acc[item.severity] ?? 0) + 1 }),
    {},
  );

  return [
    "",
    `sections       ${artifacts.analysis.sections.length}`,
    `substitutions  ${artifacts.css.substitutions.length}`,
    `unmapped       ${artifacts.css.unmapped.filter((u) => u.reason === "unrecognised").length}`,
    `images         ${artifacts.merged.pendingAssets.length}`,
    "",
    `review: ${counts.blocker ?? 0} blocker, ${counts.confirm ?? 0} confirm, ${counts.note ?? 0} note`,
    "",
  ].join("\n");
}

function report(dir: string, artifacts: ImportArtifacts): string {
  const lines = [
    `# Import report — ${basename(dir)}`,
    "",
    "Correct `overrides.json` and re-run. Never edit files under `.generated/`.",
    "",
  ];

  for (const severity of ["blocker", "confirm", "note"] as const) {
    const items = artifacts.review.filter((r) => r.severity === severity);
    if (items.length === 0) continue;

    lines.push(`## ${severity} (${items.length})`, "");
    for (const item of items) lines.push(`- \`${item.at}\` — ${item.message}`);
    lines.push("");
  }

  lines.push("## Images pending download", "");
  for (const asset of artifacts.merged.pendingAssets) {
    lines.push(`- \`${asset.sectionPath}\` ← ${asset.sourceUrl}`);
  }

  return `${lines.join("\n")}\n`;
}

// ============================================================================
// FS
// ============================================================================

function read(dir: string, name: string): string {
  const path = join(dir, name);
  if (!existsSync(path)) {
    console.error(`Missing ${path} — run \`import-template init\` first.`);
    process.exit(EXIT.usage);
  }
  return readFileSync(path, "utf8");
}

function readOverrides(dir: string): Overrides {
  const path = join(dir, "overrides.json");
  if (!existsSync(path)) return {};

  try {
    return JSON.parse(readFileSync(path, "utf8")) as Overrides;
  } catch (error) {
    // Silently ignoring a malformed overrides file would mean every correction
    // in it is dropped, and the drafts would look plausibly wrong.
    console.error(`overrides.json is not valid JSON: ${(error as Error).message}`);
    process.exit(EXIT.usage);
  }
}

function write(dir: string, name: string, data: unknown): void {
  writeFileSync(join(dir, name), `${JSON.stringify(data, null, 2)}\n`);
}

function json<T = any>(dir: string, name: string): T {
  try {
    return JSON.parse(read(dir, name)) as T;
  } catch (error) {
    console.error(`${join(dir, name)} is not valid JSON: ${(error as Error).message}`);
    process.exit(EXIT.usage);
  }
}
