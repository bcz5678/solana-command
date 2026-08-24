// ============================================================================
// tools/template-import/normalize.ts
//
// STAGE 0 — normalize the source before anything hashes, parses or maps it.
//
// Run once, in `init`. This is the ONLY stage permitted to alter the source,
// which is what makes `sourceHash` honest: everything downstream reads the
// normalized artifact, so the hash covers what actually renders.
//
// Two files result:
//
//   source.original.html   exactly what we were given. Never read by the
//                          pipeline; it exists so step 9 can diff against the
//                          page we're claiming to reproduce.
//   source.html            normalized. Every other stage reads this.
//
// Normalization reserializes through linkedom, so attribute quoting, entity
// encoding and void-element form may all shift, and unclosed tags get closed.
// That's a deliberate trade: linkedom reserializes at render time regardless,
// so doing it here means the working copy matches what ships.
// ============================================================================

import { parseHTML } from "linkedom";

export interface NormalizeResult {
  /** Normalized document, for source.html. */
  html: string;
  /** Extracted stylesheet contents, for source.css. */
  css: string;
  /** <link rel=stylesheet> hrefs — NOT extracted; they're bundle assets. */
  linkedStylesheets: string[];
  /** Scripts found and stripped from the working copy. */
  strippedScripts: string[];
  /** Every alteration made, for the init log and IMPORT_REPORT. */
  changes: string[];
  warnings: string[];
}

export function normalizeSource(raw: string): NormalizeResult {
  const { document } = parseHTML(raw);

  const changes: string[] = [];
  const warnings: string[] = [];

  trimHrefs(document, changes);
  assignSectionIds(document, changes);
  const css = extractStyles(document, changes);
  const linkedStylesheets = collectLinkedStylesheets(document, warnings);
  const strippedScripts = noteScripts(document, warnings);

  checkStructure(raw, document, changes, warnings);

  return {
    html: serialize(document),
    css,
    linkedStylesheets,
    strippedScripts,
    changes,
    warnings,
  };
}

// ============================================================================
// HREFS
// ============================================================================

/**
 * Trim whitespace inside href values.
 *
 * Sources routinely ship `href=" #ipo"`. Trimming at each consumer means four
 * places to forget — sectionNodes' nav selector, rewriteAnchors, the dangling
 * link sweep, and detectNav — so it happens once, here.
 *
 * Browsers are themselves inconsistent about leading whitespace in fragment
 * identifiers, so this is a correctness fix as much as a tooling convenience.
 */
function trimHrefs(document: Document, changes: string[]): void {
  for (const el of Array.from(document.querySelectorAll("[href], [src], [action]"))) {
    for (const attr of ["href", "src", "action"]) {
      const raw = el.getAttribute(attr);
      if (raw === null) continue;

      const trimmed = raw.trim();
      if (trimmed === raw) continue;

      el.setAttribute(attr, trimmed);
      changes.push(`${el.tagName.toLowerCase()}[${attr}]: "${raw}" → "${trimmed}"`);
    }
  }
}

// ============================================================================
// STYLES
// ============================================================================

/**
 * Move every inline <style> into source.css and remove the tags.
 *
 * Extraction is not cosmetic. The CSS pass wants one clean input, and a
 * stylesheet that stays inline can't be diffed after rewriting — the rewritten
 * version would have to be spliced back into the markup, which reserializes
 * the document and makes every subsequent hash meaningless.
 */
function extractStyles(document: Document, changes: string[]): string {
  const blocks = Array.from(document.querySelectorAll("style"));
  if (blocks.length === 0) return "";

  const css = blocks
    .map((el, i) => {
      const content = el.textContent ?? "";
      return blocks.length > 1
        ? `/* ---- <style> block ${i + 1} of ${blocks.length} ---- */\n${content}`
        : content;
    })
    .join("\n\n");

  for (const el of blocks) el.remove();

  changes.push(
    `extracted ${blocks.length} <style> block${blocks.length === 1 ? "" : "s"} to source.css`,
  );

  return css.trim();
}

/**
 * Report linked stylesheets without extracting them.
 *
 * These are the bundle's own assets — icon fonts, vendor CSS. They belong in
 * `bundleAssets` and get copied verbatim, not tokenized. Extracting them into
 * source.css would put third-party rules through the substitution pass, where
 * every one of them shows up as an unmapped literal.
 */
function collectLinkedStylesheets(document: Document, warnings: string[]): string[] {
  const hrefs = Array.from(document.querySelectorAll('link[rel="stylesheet"]'))
    .map((el) => el.getAttribute("href"))
    .filter((href): href is string => Boolean(href));

  if (hrefs.length > 0) {
    warnings.push(
      `${hrefs.length} linked stylesheet(s) left in place: ${hrefs.join(", ")}. ` +
      `Add them to bundleAssets — they are copied, not tokenized. If any contains ` +
      `rules you want customisable, append it to source.css instead.`,
    );
  }

  return hrefs;
}

// ============================================================================
// SCRIPTS
// ============================================================================

/**
 * Record scripts, but leave them in the working copy.
 *
 * sanitizeDocument strips them at render time unconditionally; removing them
 * here as well would mean the strip report is empty and a reviewer never sees
 * what the source was doing. Listing them at init is how the behaviour that
 * needs re-adding as `approvedScripts` becomes visible on day one.
 */
function noteScripts(document: Document, warnings: string[]): string[] {
  const scripts = Array.from(document.querySelectorAll("script"))
    .map((el) => (el.getAttribute("src") ? `src=${el.getAttribute("src")}` : inlineLabel(el)))
    .filter(Boolean);

  if (scripts.length > 0) {
    warnings.push(
      `${scripts.length} script(s) in the source. All are stripped at render. ` +
      `Any behaviour worth keeping must be re-added as sanitize.approvedScripts: ` +
      scripts.join("; "),
    );
  }

  return scripts;
}

/** First meaningful line of an inline script, for the report. */
function inlineLabel(el: Element): string {
  const body = (el.textContent ?? "").trim();
  const first = body.split("\n").map((l) => l.trim()).find((l) => l && !l.startsWith("//"));
  return `inline: ${(first ?? "(empty)").slice(0, 60)}`;
}

// ============================================================================
// STRUCTURE
// ============================================================================

/**
 * Report what reserialization silently repaired.
 *
 * A parser auto-closing an unclosed tag changes the tree, and therefore changes
 * which elements are descendants of which. In the reference template the hero's
 * `<div class="content">` is never closed, so the copy button and the social
 * row become its children — every relative selector inside that section
 * inherits the difference. Better said out loud at init than discovered when a
 * slot writes to the wrong node.
 */
function checkStructure(
  raw: string,
  document: Document,
  changes: string[],
  warnings: string[],
): void {
  // Cheap, deliberately approximate: a real balance check needs a parser that
  // reports errors, and linkedom repairs silently rather than complaining.
  for (const tag of ["div", "section", "p", "a", "ul", "li"]) {
    const open = (raw.match(new RegExp(`<${tag}\\b`, "gi")) ?? []).length;
    const close = (raw.match(new RegExp(`</${tag}>`, "gi")) ?? []).length;

    if (open > close) {
      warnings.push(
        `<${tag}> appears ${open} time(s) but closes ${close} — the parser has ` +
        `auto-closed ${open - close}. Check the resulting nesting in source.html.`,
      );
    }
  }

  // Content after </html> is relocated into the body by the parser. Common with
  // scripts appended at the end of a file.
  if (/<\/html\s*>[\s\S]*\S/i.test(raw)) {
    changes.push("content after </html> relocated into the document");
  }

  if (!document.querySelector("html")?.getAttribute("lang")) {
    warnings.push('No lang attribute on <html> — meta.locale will default to "en".');
  }
}

// ============================================================================
// SERIALIZE
// ============================================================================

function serialize(document: Document): string {
  const root = document.documentElement;
  if (!root) throw new Error("Source has no <html> element after parsing.");

  return `<!DOCTYPE html>\n${root.outerHTML}\n`;
}


/**
 * Give every section-like element an id.
 *
 * A section with no id cannot be targeted by sectionNodes, so it cannot be
 * switched off in the wizard. Assigning here — the one stage permitted to alter
 * the source — makes `sourceId` reliably present downstream rather than an
 * optionality every consumer has to handle.
 *
 * Derived from the section's own heading where possible, so the generated id
 * reads like the source's own and is recognisable in a selector. Falls back to
 * position. Existing ids are never touched: they may already be nav targets.
 */
function assignSectionIds(document: Document, changes: string[]): void {
  const taken = new Set(
    Array.from(document.querySelectorAll("[id]"))
      .map((el) => el.getAttribute("id") ?? "")
      .filter(Boolean),
  );

  const sections = Array.from(document.querySelectorAll("section"));

  sections.forEach((section, index) => {
    if (section.getAttribute("id")) return;

    const heading = section.querySelector("h1, h2, h3, h4, h5, h6");
    const base = slug(heading?.textContent ?? "") || `section-${index + 1}`;

    let id = base;
    let n = 2;
    while (taken.has(id)) id = `${base}-${n++}`;

    taken.add(id);
    section.setAttribute("id", id);
    changes.push(`assigned id="${id}" to section ${index + 1} (had none)`);
  });
}

/** Local, deliberately. schema's slugify() operates on nav labels; this is for
 *  DOM ids and must not drift if that one changes. */
function slug(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/[\s_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}