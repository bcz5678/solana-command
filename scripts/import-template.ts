// ============================================================================
// scripts/import-template.ts
//
//   pnpm import-template init    <file.html> <template-id> [--dir <root>]
//   pnpm import-template analyze <template-dir>
//   pnpm import-template check   <template-dir>      # CI, no writes
//
//   pnpm import-template preset  <template-dir> [--dir <root>]  # mint ids, assign slugs, parse PresetContentSchema
//
// --dir overrides the repo-relative root a command would otherwise hardcode:
// for init, where templates/{id} is created; for preset, where the authored
// preset package is written. Without it, both commands can only ever act on
// the real repo tree — there's no way to point either at a scratch directory,
// which is exactly the friction a test suite around this CLI runs into.
//
// Not yet implemented — the stages that follow review:
//   assets  <dir>   download source images, generate variants, upload to seed
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
import { join, basename, dirname } from "node:path";
import { parseHTML } from "linkedom";
import { normalizeSource } from "../tools/template-import/normalize";


import { authorPreset } from "../tools/template-import/author-preset";
import { runImport, type Overrides, type ImportArtifacts, type ReviewItem } from '../tools/template-import/pipeline'
import { emitTemplate, validateEmitInputs } from "../tools/template-import/emit";
import type { TemplatePreset } from "@site/schema";

const EXIT = { ok: 0, usage: 1, failed: 2 } as const;0

const [command, ...rest] = process.argv.slice(2);
const { positional: args, dir: dirFlag } = parseArgs(rest);

switch (command) {
  case "init":    init(args[0], args[1], dirFlag); break;
  case "analyze": analyzeDir(args[0], { write: true }); break;
  case "check":   checkDir(args[0], dirFlag); break;
  case "preset":  presetDir(args[0], dirFlag); break;
  case "emit":    emitDir(args[0], dirFlag); break;

  case "assets":
  case "verify":
    console.error(`"${command}" is not implemented yet.`);
    process.exit(EXIT.usage);
    break;

  default:
    console.error(
      "usage:\n" +
      "  import-template init    <file.html> <template-id> [--dir <root>]\n" +
      "  import-template analyze <template-dir>\n" +
      "  import-template check   <template-dir> [--dir <root>]\n" +
      "  import-template preset  <template-dir> [--dir <root>]\n" +
      "  import-template emit    <template-dir> [--dir <root>]",
    );
    process.exit(EXIT.usage);
}

/** Pulls `--dir <value>` (or `--dir=<value>`) out of the raw args, wherever it appears. */
function parseArgs(raw: string[]): { positional: string[]; dir?: string } {
  const positional: string[] = [];
  let dir: string | undefined;

  for (let i = 0; i < raw.length; i++) {
    const arg = raw[i]!;

    if (arg === "--dir") {
      dir = raw[++i];
      continue;
    }
    if (arg.startsWith("--dir=")) {
      dir = arg.slice("--dir=".length);
      continue;
    }
    positional.push(arg);
  }

  return { positional, dir };
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
function init(file: string, id: string, dirRoot?: string): void {
  if (!file || !id) {
    console.error("usage: import-template init <file.html> <template-id> [--dir <root>]");
    process.exit(EXIT.usage);
  }

  const dir = join(dirRoot ?? "templates", id);
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
function checkDir(dir: string, dirRoot?: string): void {
  const artifacts = analyzeDir(dir, { write: false });
  const blockers = artifacts.review.filter((r) => r.severity === "blocker");

  const todos = JSON.stringify(artifacts.spec).match(/"TODO/g)?.length ?? 0;

  let failed = blockers.length > 0 || todos > 0;

  for (const item of blockers) console.error(`BLOCKER  ${item.at}  ${item.message}`);
  if (todos > 0) console.error(`BLOCKER  spec  ${todos} unresolved TODO path(s).`);

  // Only meaningful once a preset exists — check runs on fresh imports too,
  // where the count it would compare against doesn't exist yet.
  const presetJsonFile = join(presetRoot(basename(dir), dirRoot), "presets", "original.json");

  if (existsSync(presetJsonFile)) {
    const preset = json<TemplatePreset>(dirname(presetJsonFile), basename(presetJsonFile));
    const emitBlockers = validateEmitInputs(artifacts.analysis, preset.content.sections.length);

    for (const blocker of emitBlockers) console.error(`BLOCKER  emit  ${blocker}`);
    if (emitBlockers.length > 0) failed = true;
  }

  if (!failed) {
    console.log("OK");
    process.exit(EXIT.ok);
  }

  process.exit(EXIT.failed);
}

// ============================================================================
// PRESET
// ============================================================================

/**
 * Base directory a template package (bundle, manifest, presets/) is written
 * into. The one place `--dir`'s default gets hardcoded, so `preset` and
 * `emit` — which write into the same package — cannot silently disagree on
 * where it lives.
 */
function presetRoot(templateId: string, dirRoot?: string): string {
  return join(dirRoot ?? "site-platform/renderer/templates", templateId);
}

/**
 * Step 7. Unlike `analyze`, this writes OUTSIDE the working directory and into
 * the template package, and the result is meant to be edited by hand
 * afterwards — so it refuses to clobber rather than regenerating silently.
 *
 * Writes a .json sibling alongside the hand-edited .ts: `emit` needs to read
 * the preset back, and a CLI reading a .ts module means either a dynamic
 * import() (making every caller async for one read) or a plain data file.
 * The .json is generated output like the .ts, just consumed by the tool
 * instead of by a human — never hand-edit it, it's overwritten every run
 * whether or not the .ts already exists.
 */
function presetDir(dir: string, dirRoot?: string): void {
  if (!dir) {
    console.error("usage: import-template preset <template-dir> [--dir <root>]");
    process.exit(EXIT.usage);
  }

  const templateId = basename(dir);
  const presetId = "original";

  const outDir = join(presetRoot(templateId, dirRoot), "presets");
  const outFile = join(outDir, `${presetId}.ts`);
  const jsonFile = join(outDir, `${presetId}.json`);
  const pendingFile = join(outDir, `${presetId}.pending.json`);

  if (existsSync(outFile)) {
    console.error(
      `${outFile} already exists.\n` +
      `Presets are hand-edited after generation — delete it deliberately if you\n` +
      `want to regenerate, or pass a different preset id.`,
    );
    process.exit(EXIT.usage);
  }

  const { preset, source, warnings, pendingAssets } = authorPreset({
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
  writeFileSync(jsonFile, `${JSON.stringify(preset, null, 2)}\n`);
  writeFileSync(pendingFile, `${JSON.stringify(pendingAssets, null, 2)}\n`);

  console.log(`Wrote ${outFile}`);
  console.log(`  ${preset.content.sections.length} sections, ${preset.mustReplace.length} mustReplace paths`);
  if (pendingAssets.length > 0) {
    console.log(`  ${pendingAssets.length} image(s) pending fetch — see ${pendingFile}`);
  }

  for (const warning of warnings) console.log(`  ! ${warning}`);
}

/**
 * Read a preset back for tooling (emit, check) via its .json sibling rather
 * than the hand-edited .ts — see presetDir()'s comment for why.
 */
function loadPreset(tsPath: string): TemplatePreset {
  const jsonPath = tsPath.replace(/\.ts$/, ".json");

  if (!existsSync(jsonPath)) {
    console.error(
      `Missing ${jsonPath} — run \`import-template preset\` to author it ` +
      `(it's written alongside the .ts, not instead of it).`,
    );
    process.exit(EXIT.usage);
  }

  return json<TemplatePreset>(dirname(jsonPath), basename(jsonPath));
}


// ============================================================================
// EMIT
// ============================================================================

/**
 * Step 8A. Rewrites the stylesheet against the substitution map and generates
 * the template package.
 *
 * Writes into the template package, not the working directory. `manifest.ts`
 * and `index.ts` are skipped when present — they hold reviewed selector work
 * and hand-wiring, and regenerating them discards it.
 */
function emitDir(dir: string, dirRoot?: string): void {
  if (!dir) {
    console.error("usage: import-template emit <template-dir> [--dir <root>]");
    process.exit(EXIT.usage);
  }

  const templateId = basename(dir);
  const html = read(dir, "source.html");
  const css = read(dir, "source.css");
  const overrides = readOverrides(dir);

  // Re-derived rather than read from .generated/, so an edited overrides.json
  // can't produce an emit that disagrees with its own analysis.
  const artifacts = runImport({ html, css, overrides, templateName: templateId });

  const presetPath = join(presetRoot(templateId, dirRoot), "presets", "original.ts");

  if (!existsSync(presetPath)) {
    console.error(`No preset at ${presetPath} — run \`import-template preset\` first.`);
    process.exit(EXIT.usage);
  }

  const result = emitTemplate({
    templateId,
    templateVersion: "1.0.0",
    html,
    css,
    tokenize: artifacts.css,
    spec: artifacts.spec,
    preset: loadPreset(presetPath),
    analysis: artifacts.analysis,
    linkedStylesheets: artifacts.analysis.linkedStylesheets,
    merged: artifacts.merged,
  });

  // Nothing is written when the map can't be trusted. A misaligned
  // sectionNodes fails silently at render — every selector still resolves,
  // just to the wrong section.
  if (result.blockers.length > 0) {
    for (const blocker of result.blockers) console.error(`BLOCKER  ${blocker}`);
    console.error("\nNothing written.");
    process.exit(EXIT.failed);
  }

  const outDir = presetRoot(templateId, dirRoot);
  mkdirSync(outDir, { recursive: true });

  for (const [name, contents] of Object.entries(result.files)) {
    const path = join(outDir, name);

    if (result.writeOnlyIfAbsent.includes(name) && existsSync(path)) {
      console.log(`  skipped ${name} (exists — hand-edited)`);
      continue;
    }

    writeFileSync(path, contents);
    console.log(`  wrote ${name}`);
  }

  console.log(`\ncss hash ${result.cssHash.slice(0, 12)}`);
  for (const warning of result.warnings) console.log(`  ! ${warning}`);
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
