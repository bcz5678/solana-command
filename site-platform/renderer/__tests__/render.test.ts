// ============================================================================
// src/site-platform/renderer/__tests__/render.test.ts
//
// Two kinds of test:
//
//   SNAPSHOT   — golden.html is the contract. An unexpected diff means someone
//                changed output without meaning to. Review the diff; if it is
//                intended, update the snapshot in the same commit.
//
//   INVARIANT  — properties that must hold for EVERY template, forever. These
//                are the ones that matter when a second template lands: a new
//                author cannot accidentally ship unescaped content or dead nav
//                anchors, because these fail in CI.
//
// Run:  pnpm vitest run
// Update snapshots:  pnpm vitest run -u
// ============================================================================

import { describe, it, expect } from "vitest";
import { renderTemplate } from "../render";
import { resolveTheme } from "../theme";
import { assignSlugs, validateAgainstManifest, ALL_VAR_NAMES, LayeredThemeSchema } from "@site/schema";
import { heroOnepagerManifest } from "../templates/hero-onepager/manifest";
import { golden, stress, hostileTheme } from "../__fixtures__/index";
import "../templates/index";   // side-effect: registers templates

const manifest = heroOnepagerManifest;

/** Standard build-mode render. No vendor deps — those are tested separately. */
async function render(definition: typeof golden, mode: "build" | "preview" = "build") {
  return renderTemplate({
    definition,
    manifest,
    vendor: [],
    rendererKey: manifest.rendererKey,
    mode,
    s3Prefix: "test-site/",
  });
}

// ============================================================================
// SNAPSHOT
// ============================================================================

describe("golden fixture", () => {
  it("matches the committed snapshot", async () => {
    const { html } = await render(golden);
    expect(html).toMatchSnapshot();
  });

  it("is deterministic across runs", async () => {
    // Non-determinism would make the snapshot useless and would defeat the
    // artifactHash-based change detection in publish_site().
    const [a, b] = await Promise.all([render(golden), render(golden)]);
    expect(a.html).toBe(b.html);
    expect(a.assetManifest.artifactHash).toBe(b.assetManifest.artifactHash);
  });

  it("passes manifest validation with no errors", async () => {
    const issues = validateAgainstManifest(golden.content, manifest);
    expect(issues.filter((i) => i.severity === "error")).toEqual([]);
  });
});

// ============================================================================
// STRESS — must not throw
// ============================================================================

describe("stress fixture", () => {
  it("renders without throwing", async () => {
    await expect(render(stress)).resolves.toBeDefined();
  });

  it("emits no empty paragraphs for an empty body array", async () => {
    const { html } = await render(stress);
    expect(html).not.toMatch(/<p>\s*<\/p>/);
  });

  it("omits og:image when no card image is set", async () => {
    const { html } = await render(stress);
    expect(html).not.toContain('property="og:image"');
    // ...and falls back to the small card rather than claiming a large one.
    expect(html).toContain('name="twitter:card" content="summary"');
  });

  it("renders a panel with no background image without a scrim", async () => {
    const { html } = await render(stress);
    expect(html).toContain('data-has-image="false"');
  });

  it("omits the contract block when the token module is absent", async () => {
    const { html } = await render(stress);
    expect(html).not.toContain("data-copy=");
  });
});

// ============================================================================
// INVARIANT — slugs and navigation
// ============================================================================

describe("slugs", () => {
  it("dedupes colliding nav labels", () => {
    const sections = assignSlugs([
      { id: "a", navLabel: "About", order: 0 },
      { id: "b", navLabel: "About", order: 1 },
      { id: "c", navLabel: "about", order: 2 },
    ]);

    expect(sections.map((s) => s.slug)).toEqual(["about", "about-2", "about-3"]);
  });

  it("falls back to the section id for a label that slugifies to nothing", () => {
    const [section] = assignSlugs([{ id: "bbbbbbbb-1111", navLabel: "🚀🚀🚀", order: 0 }]);
    expect(section!.slug).not.toBe("");
    expect(section!.slug).toMatch(/^section-/);
  });

  it("produces no duplicate element ids", async () => {
    const { html } = await render(stress);
    const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]);
    expect(new Set(ids).size).toBe(ids.length);
  });

  /**
   * THE regression test for the original template's central bug: nav hrefs were
   * built from navLabel.toLowerCase() while section ids were hardcoded
   * (#ipo, #offering, #coin), so no anchor ever resolved.
   */
  it("every nav href resolves to a section id in the document", async () => {
    const { html } = await render(golden);

    const hrefs = [...html.matchAll(/<a href="#([^"]+)"/g)]
      .map((m) => m[1]!)
      .filter((h) => h !== "top" && h !== "main");

    const ids = new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]));

    for (const href of hrefs) {
      expect(ids.has(href), `nav href #${href} has no matching element id`).toBe(true);
    }
  });

  it("excludes disabled sections from output and nav", async () => {
    const { html } = await render(golden);
    expect(html).not.toContain("Should not render");
    expect(html).not.toContain(">Hidden<");
  });
});

// ============================================================================
// INVARIANT — escaping
// ============================================================================

describe("escaping", () => {
  it("escapes script tags in user content", async () => {
    const { html } = await render(stress);
    expect(html).not.toContain("<script>alert('xss')</script>");
    expect(html).toContain("&lt;script&gt;alert(&#39;xss&#39;)&lt;/script&gt;");
  });

  it("escapes markup in nav labels", async () => {
    const { html } = await render(stress);
    expect(html).not.toContain("<img src=x onerror=alert(1)>");
  });

  it("neutralises javascript: URLs", async () => {
    const { html } = await render(stress);
    expect(html).not.toContain("javascript:");
  });

  it("emits no inline event handler attributes", async () => {
    // The whole reason the copy button became a <button> with a hashed script:
    // any on*= attribute forces 'unsafe-inline' into script-src and defeats the
    // policy on the one page where it matters most.
    const { html } = await render(golden);
    expect(html).not.toMatch(/\son(click|error|load|mouseover)\s*=/i);
  });

  it("rejects CSS injection through theme values", async () => {
    const theme = resolveTheme({
      theme: hostileTheme,
      manifest,
    });

    const emitted = Object.values(theme.vars).join(" ");

    expect(emitted).not.toContain("}");
    expect(emitted).not.toContain("@import");
    expect(emitted).not.toContain("evil.example");
    expect(emitted).not.toMatch(/expression\s*\(/i);
  });
});

// ============================================================================
// INVARIANT — theming
// ============================================================================

describe("theming", () => {
  it("leaks no hardcoded colours from the original template", async () => {
    const { css } = await render(golden);

    // Every one of these was a literal in index-template.html that a theme
    // could not change.
    for (const literal of ["#e0e0e0", "#222", "#333", "rgba(0, 0, 0, .35)", "rgba(0,0,0,.2)"]) {
      expect(css, `stylesheet still contains ${literal}`).not.toContain(literal);
    }
  });

  it("generates the heading scale from baseFontSize and scaleRatio", () => {
    const theme = resolveTheme({ theme: golden.theme, manifest });

    // 16px base, 1.25 ratio, h1 five steps up = 16 * 1.25^5 ≈ 48.828px
    expect(theme.vars["--st-font-size-h1"]).toBe("48.828px");
    expect(theme.vars["--st-font-size-h6"]).toBe("16px");
  });

  it("namespaces template-scoped tokens", () => {
    const theme = resolveTheme({ theme: golden.theme, manifest });
    expect(theme.custom["--st-tpl-header-blur"]).toBe("12px");
    // Tier 3 must not bleed into the shared surface.
    expect(theme.vars["--st-tpl-header-blur"]).toBeUndefined();
  });

  it("derives a hover colour when none is authored", () => {
    const theme = resolveTheme({ theme: golden.theme, manifest });
    expect(theme.vars["--st-color-primary-hover"]).not.toBe(
      theme.vars["--st-color-primary"],
    );
  });

  // The invariant token-vars.ts's header describes: two independent naming
  // implementations means a rename can produce CSS referencing a variable
  // nothing declares — and because rewriteCss emits var(--st-x, <literal>),
  // the page still looks right while the theme control silently does
  // nothing. Checked both directions: a table entry resolveTheme never
  // emits, and a var resolveTheme emits that the table doesn't know about.
  it("every emitted var is declared, and vice versa", () => {
    const declared = new Set(Object.keys(resolveTheme({ theme: golden.theme, manifest }).vars));
    const table = new Set(ALL_VAR_NAMES);

    expect([...table].filter((v) => !declared.has(v))).toEqual([]);
    expect([...declared].filter((v) => !table.has(v))).toEqual([]);
  });

  /**
   * The standing guard for the whole class of bug core.button was: a token in
   * the rule table with no variable, a variable with no declaration, a schema
   * field with no emission. The test above uses `golden.theme`, which supplies
   * nearly every field explicitly — so a defaulted/prefaulted field going
   * unpopulated wouldn't show up there even though it's exactly the failure
   * mode that matters (a source that never specifies core.button is the
   * COMMON case, not the exception). This one builds a theme from only the
   * fields LayeredThemeSchema actually requires, parses it — so every
   * .default()/.prefault() runs — and checks the same completeness property.
   * ALL_VAR_NAMES never includes --st-tpl-*: Tier 3 is generated from
   * `templates.{id}.{key}`, never statically listed, so it's excluded here by
   * construction rather than by a filter.
   */
  it("emits every declared variable from a theme built with only the required fields", () => {
    const minimal = LayeredThemeSchema.parse({
      id: "minimal",
      name: "Minimal",
      core: {
        colors: {
          background: "#000", surface: "#000", primary: "#000", onPrimary: "#000",
          secondary: "#000", text: "#000", textMuted: "#000", border: "#000",
          overlay: "#000", success: "#000", warning: "#000", error: "#000",
        },
        typography: { fontFamilyBase: "sans-serif" },
        spacing: {},
        motion: {},
        breakpoints: {},
      },
    });

    const declared = new Set(Object.keys(resolveTheme({ theme: minimal, manifest }).vars));

    for (const name of ALL_VAR_NAMES) {
      expect(declared.has(name), `${name} missing from vars for a minimally-parsed theme`).toBe(true);
    }
  });

  // The branch that just changed: BASE_CORE deliberately leaves
  // letterSpacingWide unset, so an uppercase button on a base theme must not
  // get 1px of tracking nobody authored. Unexercised until now — nothing else
  // in this file builds a theme with core.button.textTransform: "uppercase".
  describe("button letter-spacing", () => {
    const REQUIRED_COLORS = {
      background: "#000", surface: "#000", primary: "#000", onPrimary: "#000",
      secondary: "#000", text: "#000", textMuted: "#000", border: "#000",
      overlay: "#000", success: "#000", warning: "#000", error: "#000",
    };

    it("falls back to normal when letterSpacingWide is unset", () => {
      const theme = LayeredThemeSchema.parse({
        id: "uppercase-button", name: "Uppercase Button",
        core: {
          colors: REQUIRED_COLORS,
          typography: { fontFamilyBase: "sans-serif" },
          spacing: {}, motion: {}, breakpoints: {},
          button: { textTransform: "uppercase" },
        },
      });

      expect(resolveTheme({ theme, manifest }).vars["--st-button-letter-spacing"]).toBe("normal");
    });

    it("inherits letterSpacingWide when the template sets one", () => {
      const theme = LayeredThemeSchema.parse({
        id: "uppercase-button-wide", name: "Uppercase Button Wide",
        core: {
          colors: REQUIRED_COLORS,
          typography: { fontFamilyBase: "sans-serif", letterSpacingWide: "2px" },
          spacing: {}, motion: {}, breakpoints: {},
          button: { textTransform: "uppercase" },
        },
      });

      expect(resolveTheme({ theme, manifest }).vars["--st-button-letter-spacing"]).toBe("2px");
    });
  });
});

// ============================================================================
// INVARIANT — assets
// ============================================================================

describe("assets", () => {
  it("rewrites media to published paths in build mode", async () => {
    const { html } = await render(golden, "build");
    // A staging URL in published output expires and 403s for every visitor.
    expect(html).not.toContain("staging.example");
    expect(html).toContain("/media/");
  });

  it("keeps staging URLs in preview mode", async () => {
    const { html } = await renderTemplate({
      definition: golden,
      manifest,
      vendor: [],
      rendererKey: manifest.rendererKey,
      mode: "preview",
    });
    expect(html).toContain("staging.example");
  });

  it("invalidates only the document", async () => {
    const { assetManifest } = await render(golden);
    // If this grows, something upstream stopped content-hashing filenames.
    expect(assetManifest.invalidationPaths).toEqual(["/", "/index.html"]);
  });

  it("changes the media filename when the focal point moves", async () => {
    const moved = structuredClone(golden);
    moved.content.hero.backgroundImage!.focalY = 0.9;

    const [a, b] = await Promise.all([render(golden), render(moved)]);

    expect(a.assetManifest.media[0]!.destKey)
      .not.toBe(b.assetManifest.media[0]!.destKey);
  });

  it("requires s3Prefix in build mode", async () => {
    await expect(
      renderTemplate({
        definition: golden,
        manifest,
        vendor: [],
        rendererKey: manifest.rendererKey,
        mode: "build",
      }),
    ).rejects.toThrow(/s3Prefix/);
  });
});

// ============================================================================
// INVARIANT — document structure
// ============================================================================

describe("document", () => {
  it("declares cascade layers before any rule", async () => {
    const { html } = await render(golden);
    const layerIndex = html.indexOf("@layer reset, vendor, tokens, template, overrides;");
    const firstRule = html.indexOf("@layer reset {");
    expect(layerIndex).toBeGreaterThan(-1);
    expect(layerIndex).toBeLessThan(firstRule);
  });

  it("wraps author CSS in @layer template", async () => {
    const { html } = await render(golden);
    expect(html).toContain("@layer template {");
  });

  it("emits a skip link before the header", async () => {
    const { html } = await render(golden);
    expect(html.indexOf("skip-link")).toBeLessThan(html.indexOf("site-header"));
  });

  it("resolves copyrightYear: auto to the current year", async () => {
    const { html } = await render(stress);
    expect(html).toContain(`&copy;${new Date().getUTCFullYear()}`);
  });

  it("produces a script hash for every inline script", async () => {
    const { inlineScriptHashes } = await render(golden);
    expect(inlineScriptHashes).toHaveLength(1);
    expect(inlineScriptHashes[0]).toMatch(/^sha256-[A-Za-z0-9+/]+=*$/);
  });
});