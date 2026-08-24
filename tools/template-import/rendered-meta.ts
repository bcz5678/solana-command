// ============================================================================
// tools/template-import/rendered-meta.ts
//
// Provenance for a build render: the three inputs it actually depends on.
// Written by `emit` next to rendered.html; recomputed by `verify`/`check`
// against current on-disk state to detect drift — same reasoning as
// renderSlotted's own sourceHash check, one level up: that catches a bundle
// registered from an edited source without reimporting; this catches
// `verify`/`check` comparing against a rendered.html whose preset, source,
// or stylesheet has since changed without `emit` re-running. A preset edit
// followed by `verify` with no `emit` in between used to compare two stale
// artifacts, agree for the wrong reason, and report clean — this makes that
// refuse instead.
//
// Kept out of scripts/import-template.ts on purpose: that file's top-level
// switch calls process.exit() at import time, which makes anything defined
// there untestable except by spawning a child process (see cli.test.ts).
// This is pure enough — given resolved paths, not a --dir flag to parse —
// to import and test directly.
// ============================================================================

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { sha256Hex } from "@site/renderer";
import type { TemplateManifest, TemplatePreset } from "@site/schema";

export interface RenderedMeta {
  cssHash: string;
  presetHash: string;
  sourceHash: string;
}

const LABELS: Record<keyof RenderedMeta, string> = {
  cssHash: "the stylesheet",
  presetHash: "the preset",
  sourceHash: "source.html",
};

/**
 * Computed from whatever is on disk RIGHT NOW.
 *
 * `outIndexPath` is the template package's index.ts (exports manifest and
 * preset) — the exact module emitDir's own render step and
 * loadExpectedBackgroundUrls dynamically import, so this can never see a
 * different preset/manifest than the render that actually produced (or
 * would produce) rendered.html. `sourceHtmlPath` is the template's
 * source.html.
 */
export async function computeRenderedMeta(
  outIndexPath: string,
  sourceHtmlPath: string,
): Promise<RenderedMeta> {
  const mod = (await import(pathToFileURL(outIndexPath).href)) as {
    manifest: TemplateManifest;
    preset: TemplatePreset;
  };

  const cssHash = mod.manifest.slotted?.cssTokenized?.cssHash;
  if (!cssHash) {
    throw new Error(`${outIndexPath}: manifest has no slotted.cssTokenized.cssHash.`);
  }

  return {
    cssHash,
    presetHash: sha256Hex(JSON.stringify(mod.preset)),
    sourceHash: sha256Hex(readFileSync(sourceHtmlPath, "utf8")),
  };
}

export function writeRenderedMeta(metaPath: string, meta: RenderedMeta): void {
  writeFileSync(metaPath, JSON.stringify(meta, null, 2));
}

/**
 * Refuses rather than warns: a render with no meta file predates this guard,
 * or one that doesn't match current inputs was produced from something that
 * has since changed — either way its provenance is unknown, and comparing
 * against it is the exact "stale artifact, agreement means nothing" failure
 * this exists to close. Throws; callers decide whether that's a hard exit
 * (verify) or something to report and skip (check).
 */
export async function assertRenderedFresh(
  metaPath: string,
  outIndexPath: string,
  sourceHtmlPath: string,
): Promise<void> {
  if (!existsSync(metaPath)) {
    throw new Error(
      `No ${metaPath} — this render predates the staleness guard, so its ` +
      `provenance is unknown. Re-run \`import-template emit\`.`,
    );
  }

  const recorded = JSON.parse(readFileSync(metaPath, "utf8")) as RenderedMeta;
  const current = await computeRenderedMeta(outIndexPath, sourceHtmlPath);

  const drifted = (Object.keys(LABELS) as Array<keyof RenderedMeta>)
    .filter((key) => recorded[key] !== current[key]);

  if (drifted.length === 0) return;

  throw new Error(
    `rendered.html is stale — ${drifted.map((k) => LABELS[k]).join(" and ")} ` +
    `changed since emit. Re-run \`import-template emit\`.`,
  );
}
