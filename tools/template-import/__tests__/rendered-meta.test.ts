// ============================================================================
// tools/template-import/__tests__/rendered-meta.test.ts
//
// The staleness guard: `verify`/`check` used to read .generated/rendered.html
// unconditionally — a preset edited (or source.html, or the stylesheet)
// after the last `emit`, with no `emit` re-run in between, meant comparing
// against a render that no longer reflects current inputs. Both sides of
// that comparison were frozen at the OLD state, so it agreed and reported
// clean — silence that meant nothing. Caught for real mid-session: editing
// spacex-ipo's overlayOpacity and running `verify` without re-emitting
// produced a clean report right up until `emit` was re-run and the SAME
// input produced three new "unexpected" diffs.
//
// Each drift scenario below uses a SEPARATE fixture directory rather than
// editing one directory's index.ts and re-importing — Node's ESM loader
// caches a module by resolved URL for the life of the process, so
// re-importing the same path after editing it on disk would silently return
// the stale cached module instead of proving anything. In real use this is
// moot (verify/check run as fresh child processes — see cli.test.ts), but a
// single vitest process importing the same URL twice would produce a false
// pass. Separate directories sidestep the cache without faking what's
// actually being tested: whether assertRenderedFresh's comparison correctly
// flags a real difference between two states.
// ============================================================================

import { describe, it, expect, afterAll } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import {
  computeRenderedMeta,
  writeRenderedMeta,
  assertRenderedFresh,
  type RenderedMeta,
} from "../rendered-meta";

const sha256Hex = (value: string) => createHash("sha256").update(value, "utf8").digest("hex");

const SCRATCH = mkdtempSync(join(tmpdir(), "rendered-meta-test-"));

afterAll(() => {
  rmSync(SCRATCH, { recursive: true, force: true });
});

/**
 * A minimal template package on disk: source.html plus an index.ts
 * exporting `manifest` (just enough for slotted.cssTokenized.cssHash) and
 * `preset` (any JSON-serializable object) — computeRenderedMeta doesn't
 * parse either against the real schema, it only reads these two paths.
 */
function fixture(
  name: string,
  opts: { sourceHtml?: string; cssHash?: string | null; preset?: Record<string, unknown> } = {},
) {
  const dir = join(SCRATCH, name);
  mkdirSync(dir, { recursive: true });

  const sourceHtmlPath = join(dir, "source.html");
  writeFileSync(sourceHtmlPath, opts.sourceHtml ?? "<html>fixture</html>");

  const manifestLiteral = opts.cssHash === null
    ? "{}"
    : `{ slotted: { cssTokenized: { cssHash: ${JSON.stringify(opts.cssHash ?? "fixed-css-hash")} } } }`;

  const outIndexPath = join(dir, "index.ts");
  writeFileSync(
    outIndexPath,
    `export const manifest = ${manifestLiteral};\n` +
    `export const preset = ${JSON.stringify(opts.preset ?? { id: "original" })};\n`,
  );

  return { dir, outIndexPath, sourceHtmlPath, metaPath: join(dir, "rendered.meta.json") };
}

describe("computeRenderedMeta", () => {
  it("hashes source.html and JSON.stringify(preset), and reads cssHash straight off the manifest", async () => {
    const f = fixture("compute-basic", {
      sourceHtml: "<html>hello</html>",
      cssHash: "abc123",
      preset: { id: "original", theme: { core: { colors: { primary: "#fff" } } } },
    });

    const meta = await computeRenderedMeta(f.outIndexPath, f.sourceHtmlPath);

    expect(meta.cssHash).toBe("abc123");
    expect(meta.sourceHash).toBe(sha256Hex("<html>hello</html>"));
    expect(meta.presetHash).toBe(
      sha256Hex(JSON.stringify({ id: "original", theme: { core: { colors: { primary: "#fff" } } } })),
    );
  });

  it("throws when the manifest has no slotted.cssTokenized.cssHash", async () => {
    const f = fixture("compute-no-hash", { cssHash: null });
    await expect(computeRenderedMeta(f.outIndexPath, f.sourceHtmlPath)).rejects.toThrow(
      /cssTokenized\.cssHash/,
    );
  });
});

describe("assertRenderedFresh", () => {
  it("resolves without throwing when the recorded meta matches current disk state", async () => {
    const f = fixture("fresh-match");
    writeRenderedMeta(f.metaPath, await computeRenderedMeta(f.outIndexPath, f.sourceHtmlPath));

    await expect(assertRenderedFresh(f.metaPath, f.outIndexPath, f.sourceHtmlPath)).resolves.toBeUndefined();
  });

  it("refuses when no meta file exists — provenance unknown, not just 'no diff to show'", async () => {
    const f = fixture("no-meta-file");
    await expect(assertRenderedFresh(f.metaPath, f.outIndexPath, f.sourceHtmlPath)).rejects.toThrow(
      /predates the staleness guard/,
    );
  });

  it("refuses and names the preset when the preset changed", async () => {
    // "before" state: what emit recorded.
    const before = fixture("preset-drift-before", { preset: { overlayOpacity: 0.35 } });
    const recorded = await computeRenderedMeta(before.outIndexPath, before.sourceHtmlPath);
    writeRenderedMeta(before.metaPath, recorded);

    // "after" state: the SAME source.html and cssHash, a DIFFERENT preset —
    // exactly the shape of editing overlayOpacity and forgetting to re-emit.
    const after = fixture("preset-drift-after", { preset: { overlayOpacity: 0.6 } });

    await expect(
      assertRenderedFresh(before.metaPath, after.outIndexPath, before.sourceHtmlPath),
    ).rejects.toThrow(/rendered\.html is stale — the preset changed since emit/);
  });

  it("refuses and names source.html when the source changed", async () => {
    const before = fixture("source-drift-before", { sourceHtml: "<html>v1</html>" });
    writeRenderedMeta(before.metaPath, await computeRenderedMeta(before.outIndexPath, before.sourceHtmlPath));

    const after = fixture("source-drift-after", { sourceHtml: "<html>v2</html>" });

    await expect(
      assertRenderedFresh(before.metaPath, before.outIndexPath, after.sourceHtmlPath),
    ).rejects.toThrow(/rendered\.html is stale — source\.html changed since emit/);
  });

  it("refuses and names the stylesheet when cssHash changed", async () => {
    const before = fixture("css-drift-before", { cssHash: "hash-v1" });
    writeRenderedMeta(before.metaPath, await computeRenderedMeta(before.outIndexPath, before.sourceHtmlPath));

    const after = fixture("css-drift-after", { cssHash: "hash-v2" });

    await expect(
      assertRenderedFresh(before.metaPath, after.outIndexPath, before.sourceHtmlPath),
    ).rejects.toThrow(/rendered\.html is stale — the stylesheet changed since emit/);
  });

  it("names every drifted input together, not just the first one found", async () => {
    const before = fixture("multi-drift-before", {
      sourceHtml: "<html>v1</html>", cssHash: "hash-v1", preset: { v: 1 },
    });
    writeRenderedMeta(before.metaPath, await computeRenderedMeta(before.outIndexPath, before.sourceHtmlPath));

    const after = fixture("multi-drift-after", {
      sourceHtml: "<html>v2</html>", cssHash: "hash-v2", preset: { v: 2 },
    });

    let message = "";
    try {
      await assertRenderedFresh(before.metaPath, after.outIndexPath, after.sourceHtmlPath);
    } catch (error) {
      message = (error as Error).message;
    }

    expect(message).toContain("the stylesheet");
    expect(message).toContain("the preset");
    expect(message).toContain("source.html");
  });
});

describe("writeRenderedMeta", () => {
  it("writes exactly what computeRenderedMeta returned, round-trippable as JSON", async () => {
    const f = fixture("round-trip");
    const meta = await computeRenderedMeta(f.outIndexPath, f.sourceHtmlPath);
    writeRenderedMeta(f.metaPath, meta);

    const written = JSON.parse(readFileSync(f.metaPath, "utf8")) as RenderedMeta;
    expect(written).toEqual(meta);
  });
});
