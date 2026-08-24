// ============================================================================
// tools/template-import/__tests__/assets.test.ts
//
// bundleLocalFile's contentType used to come from extname() alone. A
// browser-saved page routinely links a stylesheet with no extension at all —
// Chrome's "Save as, webpage complete" saves Google Fonts' CSS as a bare
// "css2" (the real request is fonts.googleapis.com/css2?...) — so
// MIME_TYPES[""] misses and the file bundles as application/octet-stream,
// which a browser correctly refuses to apply as a stylesheet. rel is a fact
// about the file the filename alone doesn't carry; trusting it when the
// extension is silent is the fix, without ever overriding an extension that
// DID resolve to something.
// ============================================================================

import { describe, it, expect, afterAll } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { prepareAssets } from "../assets";

const SCRATCH = mkdtempSync(join(tmpdir(), "assets-test-"));
const OUT = mkdtempSync(join(tmpdir(), "assets-test-out-"));

afterAll(() => {
  rmSync(SCRATCH, { recursive: true, force: true });
  rmSync(OUT, { recursive: true, force: true });
});

function run(html: string) {
  return prepareAssets(html, [], new Set(), SCRATCH, OUT);
}

describe("prepareAssets > bundled stylesheet contentType", () => {
  it("trusts rel=\"stylesheet\" as text/css when the filename has no extension", () => {
    writeFileSync(join(SCRATCH, "css2"), "body{color:red}");

    const html = `<html><head><link rel="stylesheet" href="css2"></head></html>`;
    const result = run(html);

    expect(result.bundleAssets).toHaveLength(1);
    expect(result.bundleAssets[0]).toMatchObject({ path: "css2", contentType: "text/css" });
  });

  it("still resolves a normally-extensioned stylesheet from MIME_TYPES", () => {
    writeFileSync(join(SCRATCH, "style.css"), "body{color:red}");

    const html = `<html><head><link rel="stylesheet" href="style.css"></head></html>`;
    const result = run(html);

    expect(result.bundleAssets[0]).toMatchObject({ path: "style.css", contentType: "text/css" });
  });

  it("does not apply the stylesheet hint to a non-stylesheet link with no extension", () => {
    writeFileSync(join(SCRATCH, "manifestfile"), "{}");

    const html = `<html><head><link rel="manifest" href="manifestfile"></head></html>`;
    const result = run(html);

    expect(result.bundleAssets[0]).toMatchObject({ path: "manifestfile", contentType: "application/octet-stream" });
  });

  it("lets a real (if surprising) extension win over the stylesheet hint", () => {
    // Contrived, but proves the hint only fills a GAP rather than overriding
    // a more specific fact the extension already supplied.
    writeFileSync(join(SCRATCH, "weird.png"), "not actually a png");

    const html = `<html><head><link rel="stylesheet" href="weird.png"></head></html>`;
    const result = run(html);

    expect(result.bundleAssets[0]).toMatchObject({ path: "weird.png", contentType: "image/png" });
  });

  it("reports rel=\"stylesheet icon\" (space-separated rel values) as a stylesheet too", () => {
    writeFileSync(join(SCRATCH, "css2b"), "body{color:blue}");

    // link rel can legitimately carry multiple space-separated tokens.
    const html = `<html><head><link rel="stylesheet icon" href="css2b"></head></html>`;
    const result = run(html);

    expect(result.bundleAssets[0]).toMatchObject({ path: "css2b", contentType: "text/css" });
  });
});
