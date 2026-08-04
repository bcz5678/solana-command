// ============================================================================
// packages/site-renderer/src/document.ts
//
// Platform-owned document assembly.
//
// Template authors return fragments — head extras, body, css, inlineScripts.
// EVERYTHING structural is emitted here: doctype, the meta/OG block, the
// cascade layer declaration, the token block, vendor markup, and script hashing.
//
// That ownership is the point. A careless or hostile template cannot ship a
// page with a broken head, an unlabelled iframe, or an inline event handler
// that forces 'unsafe-inline' into the CSP.
// ============================================================================

import type { SiteDefinition } from "@site/schema";
import type { ResolvedTheme, TemplateOutput } from "./types.js";
import type { ResolvedDependency } from "./vendor.js";
import { flattenTheme } from "./theme.js";
import { esc, escAttr, safeUrl } from "./escape.js";
import { scriptHash } from "./assets.js";
import { CSS_LAYER_ORDER } from "@site/schema";

// ============================================================================
// CASCADE LAYERS
// ============================================================================

/**
 * Declared order, emitted before any rule.
 *
 * This is the fix for multi-author specificity collisions: a vendor stylesheet
 * in the `vendor` layer cannot outrank template styles no matter how specific
 * its selectors are. Authors write `@layer template { ... }` — or rather, we
 * wrap their CSS in it for them, so they cannot get it wrong.
 */

/**
 * Minimal reset. Deliberately small: templates own their own look, and a heavy
 * reset in a low layer just gets overridden.
 *
 * `scroll-padding-block-start` uses the LOGICAL axis, so it does the right
 * thing in a horizontal template where "top" is meaningless.
 */
const RESET = `@layer reset {
  *, *::before, *::after { box-sizing: border-box; }
  * { margin: 0; padding: 0; }
  html { scroll-behavior: smooth; scroll-padding-block-start: var(--st-header-h, 0px); }
  img, svg, video { display: block; max-width: 100%; }
  a { color: inherit; }
  button { font: inherit; color: inherit; background: none; border: none; cursor: pointer; }
  :where([hidden]) { display: none !important; }
  :focus-visible { outline: 2px solid var(--st-color-primary); outline-offset: 2px; }
}`;

// ============================================================================
// HEAD
// ============================================================================

  /*
  * Standard head tags: title, description, canonical, robots, OG, Twitter.
  *
  * Exported because the slotted path needs it too — it strips the imported
  * source's own SEO tags and inserts these instead. One implementation for
  * both paths, so a site's metadata does not depend on which kind of template
  * rendered it.
  */
 export function buildMetaTags(definition: SiteDefinition, ogImageUrl: string): string {
  const { meta, brand } = definition.content;
  const origin = `https://${meta.fqdn}`;
  const canonical = meta.canonicalUrl ?? origin;

  const tags: string[] = [
    `<meta charset="utf-8">`,
    `<meta name="viewport" content="width=device-width, initial-scale=1">`,
    `<title>${esc(meta.title)}</title>`,
    `<meta name="description" content="${escAttr(meta.description)}">`,
  ];

  if (meta.keywords) {
    tags.push(`<meta name="keywords" content="${escAttr(meta.keywords)}">`);
  }

  // Generated sites should not be indexed before launch. Defaulting this to
  // true during provisioning avoids a half-built site ranking for the domain.
  if (meta.noindex) {
    tags.push(`<meta name="robots" content="noindex, nofollow">`);
  }

  tags.push(`<link rel="canonical" href="${safeUrl(canonical)}">`);

  if (meta.themeColor) {
    tags.push(`<meta name="theme-color" content="${escAttr(meta.themeColor)}">`);
  }

  // ---- Open Graph ----
  tags.push(
    `<meta property="og:type" content="website">`,
    `<meta property="og:url" content="${safeUrl(origin)}">`,
    `<meta property="og:title" content="${escAttr(meta.title)}">`,
    `<meta property="og:description" content="${escAttr(meta.description)}">`,
    `<meta property="og:site_name" content="${escAttr(brand.name)}">`,
    `<meta property="og:locale" content="${escAttr(meta.locale ?? "en")}">`,
  );

  if (ogImageUrl) {
    // Absolute URL required — crawlers do not resolve relative og:image.
    const absolute = ogImageUrl.startsWith("http")
      ? ogImageUrl
      : `${origin}${ogImageUrl}`;

    tags.push(
      `<meta property="og:image" content="${safeUrl(absolute)}">`,
      `<meta property="og:image:width" content="1200">`,
      `<meta property="og:image:height" content="630">`,
    );

    // A PROPERTY, not an attribute on og:image. The original template had
    // alt="" on the og:image meta tag, which is not a thing.
    if (meta.cardImage?.alt) {
      tags.push(`<meta property="og:image:alt" content="${escAttr(meta.cardImage.alt)}">`);
    }

    tags.push(
      `<meta name="twitter:card" content="summary_large_image">`,
      `<meta name="twitter:title" content="${escAttr(meta.title)}">`,
      `<meta name="twitter:description" content="${escAttr(meta.description)}">`,
      `<meta name="twitter:image" content="${safeUrl(absolute)}">`,
    );
  } else {
    tags.push(`<meta name="twitter:card" content="summary">`);
  }

  // ---- Icons ----
  if (brand.faviconUrl) {
    tags.push(`<link rel="icon" href="${safeUrl(brand.faviconUrl)}">`);
  }

  return tags.join("\n    ");
}

// ============================================================================
// ASSEMBLY
// ============================================================================

export interface AssembleInput {
  definition: SiteDefinition;
  theme: ResolvedTheme;
  output: TemplateOutput;
  vendor: ResolvedDependency[];
  ogImageUrl: string;
}

export interface AssembleResult {
  html: string;
  /** CSP source expressions for every inline script emitted. */
  inlineScriptHashes: string[];
}

export function assembleDocument(input: AssembleInput): AssembleResult {
  const { definition, theme, output, vendor, ogImageUrl } = input;
  const { meta } = definition.content;

  // ---- Vendor head markup ----
  // Inline sprites, stylesheet links, font preloads, script tags. Ordered so
  // preloads land before the stylesheets that reference them.
  const vendorHead = vendor
    .map((v) => v.headMarkup)
    .filter(Boolean)
    .join("\n    ");

  // ---- Stylesheet ----
  // Layer declaration first, then reset, tokens, and the author's CSS wrapped
  // in @layer template so they cannot place it anywhere else.
  const stylesheet = [
    `@layer ${CSS_LAYER_ORDER.join(", ")};`,
    RESET,
    `@layer tokens {\n${flattenTheme(theme)}\n}`,
    `@layer template {\n${output.css}\n}`,
  ].join("\n\n");

  // ---- Inline scripts ----
  // Hashed for the CSP. Note these are hashed over the EXACT bytes emitted —
  // any whitespace change invalidates the hash, so the script text must not be
  // reformatted after this point.
  const scripts = output.inlineScripts ?? [];
  const hashes = scripts.map(scriptHash);

  const scriptBlock = scripts
    .map((src) => `<script>${src}</script>`)
    .join("\n  ");

  const html = `<!DOCTYPE html>
<html lang="${escAttr(meta.locale ?? "en")}" prefix="og: https://ogp.me/ns#">
  <head>
    ${buildMetaTags(definition, ogImageUrl)}
    ${vendorHead}
    <style>
${stylesheet}
    </style>
    ${output.head ?? ""}
  </head>
  <body>
${output.body}
  ${scriptBlock}
  </body>
</html>
`;

  return { html, inlineScriptHashes: hashes };
}