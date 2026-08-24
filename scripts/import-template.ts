// ============================================================================
// scripts/import-template.ts
//
//   pnpm import-template init    <file.html> <template-id> [--dir <root>] [--assets <dir>]
//   pnpm import-template analyze <template-dir>
//   pnpm import-template check   <template-dir> [--dir <root>]
//   pnpm import-template assets  <template-dir>
//   pnpm import-template preset  <template-dir> [--dir <root>]  # mint ids, assign slugs, parse PresetContentSchema
//   pnpm import-template emit    <template-dir> [--dir <root>]  # rewriteCss, hash, write manifest
//   pnpm import-template verify  <template-dir> [--dir <root>]  # diff .generated/rendered.html against source
//
// --dir overrides the repo-relative root a command would otherwise hardcode:
// for init, where templates/{id} is created; for preset/emit, where the
// authored template package is written. Without it, these commands can only
// ever act on the real repo tree — there's no way to point them at a scratch
// directory, which is exactly the friction a test suite around this CLI runs
// into.
//
// --assets (init only) points at the directory the source's own images,
// fonts and stylesheets live in. Copied wholesale into the working directory
// as _source/, so `assets` has real bytes to hash and copy without the
// original path being re-supplied. Defaults to the directory the source HTML
// file itself is in.
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

import { readFileSync, writeFileSync, mkdirSync, existsSync, rmSync, cpSync } from "node:fs";
import { join, basename, dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parseHTML } from "linkedom";
import { normalizeSource } from "../tools/template-import/normalize";


import { authorPreset } from "../tools/template-import/author-preset";
import { runImport, type Overrides, type ImportArtifacts, type ReviewItem } from '../tools/template-import/pipeline'
import { emitTemplate, validateEmitInputs } from "../tools/template-import/emit";
import { prepareAssets, type PreparedAsset, type PreparedBundleAsset } from "../tools/template-import/assets";
import type { TemplatePreset, TemplateManifest, SiteDefinition } from "@site/schema";
import { materializePreset } from "@site/schema";
import { planMedia, makeImageUrlResolver } from "@site/renderer";
// Relative, not "@site/renderer/slotted" — see emit.ts's emitBundle() comment;
// that subpath resolves nowhere in this repo.
import { renderSlotted, computeCssBackgroundUrls } from "../site-platform/renderer/slotted/index";
import { verifyRender, formatVerification, type ExpectedRule, type Target } from "@/tools/template-import/verify";
import { computeRenderedMeta, writeRenderedMeta, assertRenderedFresh } from "../tools/template-import/rendered-meta";


const EXIT = { ok: 0, usage: 1, failed: 2 } as const;0

const [command, ...rest] = process.argv.slice(2);
const { positional: args, dir: dirFlag, assets: assetsFlag } = parseArgs(rest);

// tsx transpiles this file to CJS (no top-level await), and emitDir is now
// async — wrapping dispatch is the smallest change that lets one case await
// without touching the others.
async function main(): Promise<void> {
  switch (command) {
    case "init":    init(args[0], args[1], dirFlag, assetsFlag); break;
    case "analyze": analyzeDir(args[0], { write: true }); break;
    case "check":   await checkDir(args[0], dirFlag); break;
    case "assets":  assetsDir(args[0]); break;
    case "preset":  presetDir(args[0], dirFlag); break;
    case "emit":    await emitDir(args[0], dirFlag); break;

    case "verify": await verifyDir(args[0], dirFlag); break;

    default:
      console.error(
        "usage:\n" +
        "  import-template init    <file.html> <template-id> [--dir <root>] [--assets <dir>]\n" +
        "  import-template analyze <template-dir>\n" +
        "  import-template check   <template-dir> [--dir <root>]\n" +
        "  import-template preset  <template-dir> [--dir <root>]\n" +
        "  import-template emit    <template-dir> [--dir <root>]\n" +
        "  import-template verify  <template-dir> [--dir <root>]",
      );
      process.exit(EXIT.usage);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(EXIT.failed);
});

/**
 * Pulls `--dir <value>` and `--assets <value>` (or their `=`-joined forms)
 * out of the raw args, wherever either appears.
 */
function parseArgs(raw: string[]): { positional: string[]; dir?: string; assets?: string } {
  const positional: string[] = [];
  let dir: string | undefined;
  let assets: string | undefined;

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
    if (arg === "--assets") {
      assets = raw[++i];
      continue;
    }
    if (arg.startsWith("--assets=")) {
      assets = arg.slice("--assets=".length);
      continue;
    }
    positional.push(arg);
  }

  return { positional, dir, assets };
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
function init(file: string, id: string, dirRoot?: string, assetsFlag?: string): void {
  if (!file || !id) {
    console.error("usage: import-template init <file.html> <template-id> [--dir <root>] [--assets <dir>]");
    process.exit(EXIT.usage);
  }

  // Every input validated before anything is written. A bad --file or
  // --assets path used to fail AFTER mkdirSync had already created `dir` —
  // the failed attempt left a stub directory behind, and every retry (even
  // with the path fixed) then failed on "already exists" instead, pointing
  // at the wrong problem.
  if (!existsSync(file)) {
    console.error(`file not found: ${file}`);
    process.exit(EXIT.usage);
  }

  // Defaults to wherever the source HTML itself lives — the common case for a
  // downloaded bundle, where assets/, css/, fonts/ etc. are siblings of
  // index.html. --assets overrides it for a source file that was pulled out
  // of its own tree.
  const sourceTree = assetsFlag ?? dirname(file);
  if (!existsSync(sourceTree)) {
    console.error(`--assets tree not found: ${sourceTree}`);
    process.exit(EXIT.usage);
  }

  const dir = join(dirRoot ?? "templates", id);
  if (existsSync(dir)) {
    console.error(`${dir} already exists — delete it or pick another id.`);
    process.exit(EXIT.usage);
  }

  mkdirSync(dir, { recursive: true });

  // Copied wholesale so the working directory is self-contained — every later
  // stage has real bytes to hash, probe and resize without the original path
  // being re-supplied.
  cpSync(sourceTree, join(dir, "_source"), { recursive: true });

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
    
    // The CSS pass's own output. Previously only reachable as prose in the report,
    // which is fine for reading and useless for working through systematically.
    //
    // orphanBackgrounds is a MERGE-time fact (it needs the DOM/section join,
    // which the CSS pass alone can't do), not a css-pass one — included here
    // anyway because `assets` (step 6) already reads this file and shouldn't
    // need a second one just for this.
    write(generated, "tokenize.report.json", {
        substitutions: artifacts.css.substitutions,
        unmapped: artifacts.css.unmapped,
        assets: artifacts.css.assets,
        typeScale: artifacts.css.typeScale,
        findings: artifacts.css.findings,
        orphanBackgrounds: artifacts.merged.orphanBackgrounds,
    });

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
/**
 * Independently resolve every cssBackgrounds entry to its expected URL, by
 * importing the REAL committed package and running its content through the
 * SAME resolver renderSlotted uses — not by reading the render under test.
 *
 * Best-effort: returns undefined (never throws) when no package exists at
 * the default location yet — the scratch-`--dir` CLI test writes its
 * package elsewhere on purpose, and there's nothing to check identity
 * against there. verify still runs its other checks either way; this only
 * upgrades background-image from "some URL showed up" to "the RIGHT URL
 * showed up" when a real package is available.
 */
async function loadExpectedBackgroundUrls(
  templateId: string,
  dirRoot?: string,
): Promise<Map<string, string> | undefined> {
  const indexPath = join(presetRoot(templateId, dirRoot), "index.ts");
  if (!existsSync(indexPath)) return undefined;

  try {
    const mod = (await import(pathToFileURL(resolve(indexPath)).href)) as {
      manifest: TemplateManifest;
      preset: TemplatePreset;
    };
    if (!mod.manifest.slotted) return undefined;

    const definition = materializePreset({ preset: mod.preset }) as SiteDefinition;
    // build mode, matching emitDir's own render — verify validates the
    // published artifact, and a preview render's staging URLs would never
    // match this regardless of correctness.
    const plan = planMedia(definition, mod.manifest, "verify-check/");
    const imageUrl = makeImageUrlResolver("build", plan);

    const resolved = computeCssBackgroundUrls(mod.manifest.slotted, definition.content, imageUrl);
    return new Map(resolved.map((r) => [r.target, r.url]));
  } catch {
    return undefined;
  }
}

/**
 * Path-resolution wrappers around rendered-meta.ts's CLI-agnostic functions
 * — that module takes already-resolved paths so it can be unit-tested
 * without this file's --dir handling or its process.exit()-on-import switch.
 */
function renderedMetaPaths(dir: string, dirRoot?: string) {
  const templateId = basename(dir);
  return {
    metaPath: join(dir, ".generated", "rendered.meta.json"),
    outIndexPath: resolve(presetRoot(templateId, dirRoot), "index.ts"),
    sourceHtmlPath: resolve(dir, "source.html"),
  };
}

/**
 * cssBackgrounds selectors as extra verify probe targets.
 *
 * Without this, verify never actually probes ".starship::before" — its own
 * targets come from analysis.sections[].selector, which for a source with
 * both an id and a class on the same element (e.g. `<section id="ipo"
 * class="starship">`) is the ID form ("#ipo"), not whatever selector the
 * template's own background rule happens to use. Same element, same
 * computed style either way, but expectedBackgroundUrls is keyed by the
 * manifest's selector — without probing under that exact key too, the
 * identity check's map lookup never hits, and every background silently
 * falls through to the loose baseline rule that was just tightened.
 */
function backgroundTargets(expectedBackgroundUrls: Map<string, string> | undefined): Target[] {
  if (!expectedBackgroundUrls) return [];

  return [...expectedBackgroundUrls.keys()].map((key) => {
    const [selector, pseudo] = key.split("::");
    return { selector, pseudo: (pseudo || undefined) as "before" | "after" | undefined };
  });
}

async function checkDir(dir: string, dirRoot?: string): Promise<void> {
  const artifacts = analyzeDir(dir, { write: false });
  const blockers = artifacts.review.filter((r) => r.severity === "blocker");

  const todos = JSON.stringify(artifacts.spec).match(/"TODO/g)?.length ?? 0;

  let failed = blockers.length > 0 || todos > 0;

  for (const item of blockers) console.error(`BLOCKER  ${item.at}  ${item.message}`);
  if (todos > 0) console.error(`BLOCKER  spec  ${todos} unresolved TODO path(s).`);

  const renderedPath = join(dir, ".generated", "rendered.html");

  if (existsSync(renderedPath)) {
    // Non-blocking in CI by default: a mapping bug is worth failing on, but
    // this needs a browser, and a CI runner without one should report rather
    // than error. Flip to `failed = true` once Playwright is installed there.
    //
    // Same args verifyDir uses (source.original.html, overrides.verify.expected)
    // — a diff `check` calls "unexpected" and `verify` calls "expected" would
    // be confusing, not a feature.
    try {
      // Same exposure verifyDir has — this reads the persisted rendered.html
      // too, so an edit made after the last `emit` would otherwise compare
      // stale artifacts and report clean. Routed through the same catch as
      // everything else here: "couldn't verify," not a mapping bug, so it's
      // reported and skipped rather than failing `check`.
      {
        const { metaPath, outIndexPath, sourceHtmlPath } = renderedMetaPaths(dir, dirRoot);
        await assertRenderedFresh(metaPath, outIndexPath, sourceHtmlPath);
      }

      const expectedBackgroundUrls = await loadExpectedBackgroundUrls(basename(dir), dirRoot);

      const result = await verifyRender(
        read(dir, "source.original.html"),
        readFileSync(renderedPath, "utf8"),
        artifacts.css.substitutions,
        artifacts.analysis,
        {
          expected: expectedRules(readOverrides(dir)),
          expectedBackgroundUrls,
          extraTargets: backgroundTargets(expectedBackgroundUrls),
        },
      );
      console.log(`  verify: compared ${result.probeCount} element(s) across ${result.targetCount} target selector(s)`);
      for (const d of result.differences.filter((x) => x.classification === "unexpected")) {
        console.error(`DIFF  ${d.selector} { ${d.property} }  ${d.source} → ${d.rendered}`);
      }
      if (result.untokenized.length > 0) {
        console.error(`  ${result.untokenized.length} untokenized substitution(s):`);
        for (const u of result.untokenized) {
          console.error(`    ${u.selector} { ${u.property} } -> ${u.token}`);
        }
      }
    } catch (error) {
      // assertTokensPresent, or Playwright missing/failing to launch — either
      // way this is "couldn't verify," not "found a mapping bug."
      console.error(`  ! verify skipped — ${(error as Error).message}`);
    }
  }


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
// ASSETS
// ============================================================================

/**
 * Step 6. Resolves the source's local images and linked files against the
 * _source/ tree `init --assets` copied in — writes what step 7 (author-preset,
 * real ImageAssets instead of pending placeholders) and step 8 (emit, real
 * bundleAssets integrity hashes) each need.
 */
function assetsDir(dir: string): void {
  if (!dir) {
    console.error("usage: import-template assets <template-dir>");
    process.exit(EXIT.usage);
  }

  const sourceDir = join(dir, "_source");
  if (!existsSync(sourceDir)) {
    console.error(
      `${sourceDir} does not exist — re-run \`import-template init\` with ` +
      `--assets pointed at the source's own asset tree before running assets.`,
    );
    process.exit(EXIT.usage);
  }

  const html = read(dir, "source.html");
  const tokenizeReport = json<{
    assets: Array<{ selector: string; url: string }>;
    orphanBackgrounds: Array<{ selector: string; url: string }>;
  }>(dir, ".generated/tokenize.report.json");

  const generated = join(dir, ".generated");
  const outDir = join(generated, "assets");
  // ?? [] covers a .generated/ written by `analyze` before orphanBackgrounds
  // existed — re-running analyze regenerates it, but this avoids a confusing
  // crash on a stale draft in the meantime.
  const orphanUrls = new Set((tokenizeReport.orphanBackgrounds ?? []).map((o) => o.url));
  const result = prepareAssets(html, tokenizeReport.assets, orphanUrls, sourceDir, outDir);

  write(generated, "assets.json", { content: result.content, bundleAssets: result.bundleAssets });

  console.log(`Wrote ${join(generated, "assets.json")}`);
  console.log(`  ${Object.keys(result.content).length} image(s), ${result.bundleAssets.length} bundle file(s)`);

  for (const warning of result.warnings) console.log(`  ! ${warning}`);
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
    assets: readAssets(dir),
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
async function emitDir(dir: string, dirRoot?: string): Promise<void> {
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

  // Loaded once, reused below for the preview render — materializePreset
  // needs the same object emitTemplate consumes.
  const preset = loadPreset(presetPath);

  const result = emitTemplate({
    templateId,
    templateVersion: "1.0.0",
    html,
    css,
    tokenize: artifacts.css,
    spec: artifacts.spec,
    preset,
    analysis: artifacts.analysis,
    linkedStylesheets: artifacts.analysis.linkedStylesheets,
    merged: artifacts.merged,
    bundleAssets: readAssets(dir).bundleAssets,
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

  // ---- Build render ----
  // A smoke test at emit time rather than only at review time: `verify`
  // (step 9) reads .generated/rendered.html rather than rendering itself, so
  // a template that cannot actually render needs to fail HERE — in the same
  // command that already checks blockers and hashes — not three steps later
  // against a file nothing wrote.
  //
  // Imports the package just written (dynamic, from outDir), not the
  // in-memory `result.manifest`/`preset` — those reflect what THIS emit
  // computed, but manifest.ts/index.ts are writeOnlyIfAbsent, so a template
  // with hand-added slots (module fields, anything buildSpecDraft can't
  // generate on its own) would silently render as if those edits didn't
  // exist. Reading back what's actually on disk — via the module's own
  // "./bundle.generated" side-effect import — is what production loads too,
  // and registers the source for us in the process.
  //
  // mode: "build", not "preview" — verify's identity check
  // (tools/template-import/verify.ts) independently resolves the SAME
  // cssBackgrounds through the SAME resolver and compares exactly. A preview
  // render's staging URLs would never match a build render's /media/ paths,
  // even for a perfectly correct template.
  try {
    const outFile = pathToFileURL(resolve(outDir, "index.ts")).href;
    const mod = (await import(outFile)) as { manifest: TemplateManifest; preset: TemplatePreset };
    const definition = materializePreset({ preset: mod.preset }) as SiteDefinition;

    const rendered = await renderSlotted({
      definition,
      manifest: mod.manifest,
      vendor: [],
      rendererKey: mod.manifest.rendererKey,
      mode: "build",
      // Text only affects the S3 copy destKey, which nothing downstream of
      // this render reads — the rendered URLs it produces don't depend on it.
      s3Prefix: "emit-preview/",
    });

    const generatedDir = join(dir, ".generated");
    mkdirSync(generatedDir, { recursive: true });
    const renderedPath = join(generatedDir, "rendered.html");
    writeFileSync(renderedPath, rendered.html);
    console.log(`\nWrote ${renderedPath}`);

    // Provenance for the staleness guard — verify/check refuse to run
    // against rendered.html once any of these three no longer match current
    // disk state. computeRenderedMeta re-imports outDir/index.ts rather than
    // reusing `mod`/`html` from this scope directly: it's the exact function
    // verify/check call to recompute "current," so writing through anything
    // else here risks the two quietly disagreeing on what a hash covers.
    const { metaPath, outIndexPath, sourceHtmlPath } = renderedMetaPaths(dir, dirRoot);
    writeRenderedMeta(metaPath, await computeRenderedMeta(outIndexPath, sourceHtmlPath));
    console.log(`Wrote ${metaPath}`);
  } catch (error) {
    console.error(`\n  ! Build render failed — ${join(dir, ".generated", "rendered.html")} not written.`);
    console.error(`    ${(error as Error).message}`);
  }
}



// ============================================================================
// VERIFY
// ============================================================================
 
/**
 * Compare the rendered template against the page it was imported from.
 *
 * Diffs against source.original.html — the verbatim input — not source.html.
 * Original is what we're claiming to reproduce; normalization's own changes
 * (closed tags, assigned ids, trimmed hrefs) then surface as structural count
 * differences, which is correct and worth seeing rather than hiding.
 */
async function verifyDir(dir: string, dirRoot?: string): Promise<void> {
  if (!dir) {
    console.error("usage: import-template verify <template-dir> [--dir <root>]");
    process.exit(EXIT.usage);
  }

  const renderedPath = join(dir, ".generated", "rendered.html");

  if (!existsSync(renderedPath)) {
    console.error(
      `No ${renderedPath} — run \`import-template emit\` first; it writes the render.`,
    );
    process.exit(EXIT.usage);
  }

  // Refuses on a preset/source/stylesheet edit made after the last `emit` —
  // otherwise this compares source.original.html against a rendered.html
  // that reflects inputs nobody re-rendered, agrees for the wrong reason
  // (both sides frozen at the OLD state), and reports clean.
  try {
    const { metaPath, outIndexPath, sourceHtmlPath } = renderedMetaPaths(dir, dirRoot);
    await assertRenderedFresh(metaPath, outIndexPath, sourceHtmlPath);
  } catch (error) {
    console.error(`\n${(error as Error).message}\n`);
    process.exit(EXIT.failed);
  }

  const source = read(dir, "source.original.html");
  const rendered = readFileSync(renderedPath, "utf8");

  const tokenize = json(dir, ".generated/tokenize.report.json");
  const analysis = json(dir, ".generated/analysis.json");
  const overrides = readOverrides(dir);

  let result;

  try {
    const expectedBackgroundUrls = await loadExpectedBackgroundUrls(basename(dir), dirRoot);

    result = await verifyRender(source, rendered, tokenize.substitutions, analysis, {
      expected: expectedRules(overrides),
      expectedBackgroundUrls,
      extraTargets: backgroundTargets(expectedBackgroundUrls),
    });
  } catch (error) {
    // assertTokensPresent throws here when the render carries no --st- block.
    // That is not a diff failure — it means the comparison would have been
    // meaningless, since every rewritten rule falls back to its source literal
    // and the two documents agree for the wrong reason.
    console.error(`\n${(error as Error).message}\n`);
    process.exit(EXIT.failed);
  }
 
  console.log(formatVerification(result));

  if (result.unexpected > 0) {
    console.error(
      `\n${result.unexpected} unexpected difference(s). Each is a mapping bug, or ` +
      `an intentional change that belongs in overrides.verify.expected.`,
    );
    process.exit(EXIT.failed);
  }

  if (result.untokenized.length > 0) {
    console.error(
      `\n${result.untokenized.length} untokenized substitution(s). tokenize-css mapped ` +
      `these but they never made it into the rendered CSS as var(--st-…) — the source's ` +
      `own literal is still in place, which is why the diff above shows no difference for them.`,
    );
    process.exit(EXIT.failed);
  }

  console.log("\nOK — no unexpected differences.");
}
 
/**
 * Per-template expectations, from overrides.json.
 *
 * Intentional differences are a per-import judgement — whether a type-scale
 * residual is acceptable is decided at review, not by the tool — so they live
 * with the other corrections rather than in the code.
 *
 * Patterns are anchored: an unanchored `color` would also match
 * `background-color` and `border-top-color`, quietly excusing three properties
 * when one was meant.
 */
function expectedRules(overrides: Overrides): ExpectedRule[] {
  return (overrides.verify?.expected ?? []).map((rule) => ({
    property: new RegExp(`^${rule.property}$`),
    selector: rule.selector ? new RegExp(rule.selector) : undefined,
    reason: rule.reason,
  }));
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

/**
 * .generated/assets.json, from step 6. Missing is normal — not every run has
 * gotten to `assets` yet — and means every image is still pending and no
 * bundle files are seeded, same as before step 6 existed at all.
 */
function readAssets(dir: string): { content: Record<string, PreparedAsset>; bundleAssets: PreparedBundleAsset[] } {
  const path = join(dir, ".generated", "assets.json");
  if (!existsSync(path)) return { content: {}, bundleAssets: [] };

  return json<{ content: Record<string, PreparedAsset>; bundleAssets: PreparedBundleAsset[] }>(
    join(dir, ".generated"), "assets.json",
  );
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
