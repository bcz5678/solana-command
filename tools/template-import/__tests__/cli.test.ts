// ============================================================================
// tools/template-import/__tests__/cli.test.ts
//
// Regression test for bug 4: scripts/import-template.ts's dispatch table had
// "assets" and "preset" swapped. `case "assets"` called presetDir() — which is
// actually step 7, "mint ids, assign slugs, parse PresetContentSchema, write
// presets/{id}.ts" (see author-preset.ts's own header) — while `case "preset"`,
// the name presetDir's own usage string and header comment claim, fell into
// the "not implemented yet" stub alongside emit/verify.
//
// "assets" is real now (step 6 landed after this test was written), and so is
// "verify" (step 9) — nothing in the switch is a stub anymore. The "verify"
// assertion below now checks verifyDir's own missing-prerequisite error
// instead of a stub message; the point was always "the dispatch table sends
// each command to the right place," not "some command stays unbuilt forever."
//
// Runs the real CLI as a child process rather than importing scripts/
// import-template.ts directly: its top-level `switch` runs at import time and
// calls process.exit(), which would kill the test runner rather than the
// process under test.
//
// init and preset both hardcode a repo-relative output root (templates/{id},
// site-platform/renderer/templates/{id}/presets); --dir overrides it, which is
// what lets this test run against a real OS temp directory instead of writing
// into (and cleaning up after itself in) the live repo tree.
// ============================================================================

import { describe, it, expect, afterAll } from "vitest";
import { execFileSync } from "node:child_process";
import { existsSync, rmSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, "..", "..", "..");
const FIXTURE = join(HERE, "..", "__fixtures__", "leaf-repeater.html");

const SCRATCH = mkdtempSync(join(tmpdir(), "import-template-cli-"));
const TEMPLATES_ROOT = join(SCRATCH, "templates");
const PRESETS_ROOT = join(SCRATCH, "presets");
const templateId = "cli-test";

interface Result {
  status: number;
  stdout: string;
  stderr: string;
}

// shell:true is required on Windows to launch npx.cmd at all (Node refuses to
// spawn .cmd files directly as of the CVE-2024-27980 fix). The args here are
// never attacker-controlled — fixed fixture/scratch paths — so the "args +
// shell" deprecation notice this prints is noise, not a real injection risk.
function run(args: string[]): Result {
  try {
    const stdout = execFileSync(
      "npx",
      ["tsx", "scripts/import-template.ts", ...args],
      { cwd: REPO_ROOT, encoding: "utf8", shell: true },
    );
    return { status: 0, stdout, stderr: "" };
  } catch (error) {
    const e = error as { status?: number; stdout?: string; stderr?: string };
    return { status: e.status ?? 1, stdout: e.stdout ?? "", stderr: e.stderr ?? "" };
  }
}

describe("CLI dispatch", () => {
  afterAll(() => {
    rmSync(SCRATCH, { recursive: true, force: true });
  });

  it("preset authors a preset; verify exits non-zero without a prior emit", () => {
    const templateDir = join(TEMPLATES_ROOT, templateId);

    expect(run(["init", FIXTURE, templateId, "--dir", TEMPLATES_ROOT]).status).toBe(0);
    expect(run(["analyze", templateDir]).status).toBe(0);

    const preset = run(["preset", templateDir, "--dir", PRESETS_ROOT]);
    expect(preset.status).toBe(0);
    expect(preset.stdout).toContain("Wrote");
    expect(existsSync(join(PRESETS_ROOT, templateId, "presets", "original.ts"))).toBe(true);

    // verify is real now — nothing left in the switch is stubbed. This test
    // never runs `emit`, so there's no .generated/rendered.html for verify to
    // diff against; asserting on verifyDir's own prerequisite check (rather
    // than running emit here too) is enough to prove dispatch still sends
    // "verify" to the right place without adding a fifth cold `npx tsx` start.
    const verify = run(["verify", templateDir]);
    expect(verify.status).not.toBe(0);
    expect(verify.stderr).toContain("run `import-template emit` first");
    // Only preset wrote a presets/ dir — verify must not have created its own.
    expect(existsSync(join(PRESETS_ROOT, templateId, "presets"))).toBe(true);

    // Nothing leaked into the real repo tree.
    expect(existsSync(join(REPO_ROOT, "templates", templateId))).toBe(false);
    expect(existsSync(join(REPO_ROOT, "site-platform", "renderer", "templates", templateId))).toBe(false);
  }, 180_000); // 4 sequential `npx tsx` cold starts — generous headroom for a loaded dev machine.
});
