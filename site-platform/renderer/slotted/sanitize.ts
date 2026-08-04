// ============================================================================
// src/site-platform/renderer/slotted/sanitize.ts
//
// Sanitizes third-party markup before it can reach a customer domain.
//
// This is the security boundary that tokenized templates get for free by
// generating every byte. A purchased theme's bundled JavaScript runs on a page
// displaying a contract address next to a copy button — a bundled
// address-swapper is indistinguishable from a bundled analytics snippet until
// someone reads it. So: strip everything executable, re-add only what a
// reviewer approved.
//
// Every removal is REPORTED, not silent. Review of an imported template is a
// diff of the strip report, not a leap of faith.
// ============================================================================

import type { SanitizePolicy } from "@site/schema";
import { SlottedDocument, SlottedElement } from './dom';


export interface StripReport {
  /** Executable content removed. Every entry should be reviewed. */
  scripts: Array<{ src?: string; preview: string }>;
  /** on* attributes removed, by element. */
  eventHandlers: Array<{ element: string; attribute: string }>;
  /** Third-party origins referenced by the source. */
  externalOrigins: Array<{ origin: string; via: string; count: number }>;
  /** Elements removed by policy — iframes, forms, stripSelectors. */
  elements: Array<{ reason: string; preview: string }>;
  /** Non-fatal oddities worth a human glance. */
  warnings: string[];
}

export function emptyReport(): StripReport {
  return {
    scripts: [],
    eventHandlers: [],
    externalOrigins: [],
    elements: [],
    warnings: [],
  };
}

// ============================================================================
// SANITIZE
// ============================================================================

export interface SanitizeOptions {
  policy: SanitizePolicy;
  /** Bundle asset paths that are legitimate local references. */
  knownAssets: Set<string>;
}

export function sanitizeDocument(
  doc: SlottedDocument,
  opts: SanitizeOptions,
): StripReport {
  const report = emptyReport();
  const { policy } = opts;

  // ---- 1. Policy strip selectors ----
  // The source's cookie banner, its own analytics container, a "built by" badge.
  for (const selector of policy.stripSelectors) {
    for (const el of doc.querySelectorAll(selector)) {
      report.elements.push({ reason: `stripSelectors: ${selector}`, preview: preview(el) });
      el.remove();
    }
  }

  // ---- 2. All scripts ----
  // Unconditional. Behaviour comes back only via policy.approvedScripts, which
  // are committed source a reviewer read.
  for (const el of doc.querySelectorAll("script")) {
    report.scripts.push({
      src: el.getAttribute("src") ?? undefined,
      preview: (el.textContent ?? "").slice(0, 200),
    });
    el.remove();
  }

  // ---- 3. <base> ----
  // A <base href> silently reroutes every relative URL in the document,
  // including ones we rewrite to the site's own asset prefix.
  for (const el of doc.querySelectorAll("base")) {
    report.elements.push({ reason: "base element rewrites relative URLs", preview: preview(el) });
    el.remove();
  }

  // ---- 4. Event handler attributes ----
  // Any on*= forces 'unsafe-inline' into script-src and defeats the CSP.
  for (const el of doc.querySelectorAll("*")) {
    // Copy first: removing while iterating the live list skips entries.
    const names = el.attributes.map((a) => a.name);

    for (const name of names) {
      if (/^on[a-z]+$/i.test(name)) {
        report.eventHandlers.push({ element: el.tagName.toLowerCase(), attribute: name });
        el.removeAttribute(name);
      }
    }
  }

  // ---- 5. Embedded content ----
  if (!policy.allowIframes) {
    for (const tag of ["iframe", "object", "embed", "applet"]) {
      for (const el of doc.querySelectorAll(tag)) {
        report.elements.push({ reason: `${tag} not permitted by policy`, preview: preview(el) });
        el.remove();
      }
    }
  } else {
    // Kept, but constrained: an iframe with no sandbox is a same-origin hole,
    // and one with no title is unlabelled for assistive tech.
    for (const el of doc.querySelectorAll("iframe")) {
      if (!el.getAttribute("sandbox")) {
        el.setAttribute("sandbox", "allow-scripts allow-same-origin allow-popups");
        report.warnings.push("iframe had no sandbox attribute; a restrictive default was applied");
      }
      if (!el.getAttribute("title")) {
        report.warnings.push("iframe has no title attribute — unlabelled for screen readers");
      }
    }
  }

  // ---- 6. Forms ----
  // A form on a generated static site posts somewhere. That somewhere is the
  // bundle author's endpoint unless someone changed it.
  if (!policy.allowForms) {
    for (const el of doc.querySelectorAll("form")) {
      report.elements.push({ reason: "form not permitted by policy", preview: preview(el) });
      el.remove();
    }
  }

  // ---- 7. URL-bearing attributes ----
  const allowed = new Set(policy.allowedOrigins);

  const URL_ATTRS: Array<[selector: string, attr: string]> = [
    ["a[href]", "href"],
    ["link[href]", "href"],
    ["img[src]", "src"],
    ["img[srcset]", "srcset"],
    ["source[src]", "src"],
    ["source[srcset]", "srcset"],
    ["video[src]", "src"],
    ["video[poster]", "poster"],
    ["audio[src]", "src"],
    ["use[href]", "href"],
  ];

  const originCounts = new Map<string, { via: string; count: number }>();

  for (const [selector, attr] of URL_ATTRS) {
    for (const el of doc.querySelectorAll(selector)) {
      const raw = el.getAttribute(attr);
      if (!raw) continue;

      // javascript: and data:text/html are script execution vectors regardless
      // of which attribute carries them.
      const normalised = raw.replace(/[\u0000-\u0020]/g, "").toLowerCase();

      if (/^(javascript|vbscript):/.test(normalised)) {
        report.elements.push({
          reason: `${attr} contained a script URL`,
          preview: raw.slice(0, 120),
        });
        el.setAttribute(attr, "#");
        continue;
      }

      if (/^data:/.test(normalised) && !/^data:image\//.test(normalised)) {
        report.elements.push({
          reason: `${attr} contained a non-image data URL`,
          preview: raw.slice(0, 120),
        });
        el.removeAttribute(attr);
        continue;
      }

      // Absolute third-party URLs.
      if (/^https?:\/\//i.test(raw)) {
        let origin: string;
        try {
          origin = new URL(raw).origin;
        } catch {
          report.warnings.push(`Unparseable URL in ${selector}[${attr}]: ${raw.slice(0, 80)}`);
          continue;
        }

        const existing = originCounts.get(origin);
        originCounts.set(origin, {
          via: existing?.via ?? `${selector}[${attr}]`,
          count: (existing?.count ?? 0) + 1,
        });

        // Outbound <a> links to third parties are the point of a social row;
        // subresource loads from third parties are not.
        const isNavigation = selector.startsWith("a[");

        if (!isNavigation && !allowed.has(origin)) {
          report.elements.push({
            reason: `subresource from unapproved origin ${origin}`,
            preview: `${selector} ${raw.slice(0, 80)}`,
          });
          el.removeAttribute(attr);
        }
      }
    }
  }

  for (const [origin, info] of originCounts) {
    report.externalOrigins.push({ origin, via: info.via, count: info.count });
  }

  // ---- 8. Inline styles and <style> blocks ----
  // Not removed — the source's look lives here. But @import and url() targets
  // can pull from third parties, so both are checked.
  for (const el of doc.querySelectorAll("style")) {
    const css = el.textContent ?? "";

    for (const match of css.matchAll(/@import\s+(?:url\()?['"]?([^'")\s]+)/gi)) {
      report.warnings.push(`<style> contains @import of ${match[1]} — resolve to a bundle asset`);
    }

    for (const match of css.matchAll(/url\(\s*['"]?(https?:\/\/[^'")]+)/gi)) {
      report.warnings.push(`<style> loads external resource ${match[1]}`);
    }
  }

  // ---- 9. Outbound link hardening ----
  // rel="noopener noreferrer" was absent from essentially every source we have
  // looked at, which hands the opener reference to a third-party page.
  for (const el of doc.querySelectorAll("a[target=_blank]")) {
    const rel = el.getAttribute("rel") ?? "";
    if (!rel.includes("noopener")) {
      el.setAttribute("rel", `${rel} noopener noreferrer`.trim());
    }
  }

  return report;
}

function preview(el: SlottedElement): string {
  return el.outerHTML.slice(0, 160).replace(/\s+/g, " ");
}

// ============================================================================
// REPORT FORMATTING
// ============================================================================

/**
 * Human-readable strip report, written to
 * `templates/{id}/IMPORT_REPORT.md` by the importer and reviewed in the PR.
 *
 * The scripts section is the one that matters: every entry is code the bundle
 * author intended to run on the page.
 */
export function formatReport(report: StripReport, templateId: string): string {
  const lines: string[] = [`# Import report — ${templateId}`, ""];

  lines.push(`## Scripts removed (${report.scripts.length})`, "");
  if (report.scripts.length === 0) {
    lines.push("_None._", "");
  } else {
    lines.push(
      "Every entry below was code the bundle intended to execute. Re-add only",
      "what is genuinely needed, as a reviewed entry in `sanitize.approvedScripts`.",
      "",
    );
    for (const s of report.scripts) {
      lines.push(s.src ? `- **external** \`${s.src}\`` : `- **inline** \`${s.preview.slice(0, 100)}…\``);
    }
    lines.push("");
  }

  lines.push(`## Event handlers removed (${report.eventHandlers.length})`, "");
  if (report.eventHandlers.length === 0) {
    lines.push("_None._", "");
  } else {
    const grouped = new Map<string, number>();
    for (const h of report.eventHandlers) {
      const key = `${h.element}[${h.attribute}]`;
      grouped.set(key, (grouped.get(key) ?? 0) + 1);
    }
    for (const [key, count] of grouped) lines.push(`- \`${key}\` ×${count}`);
    lines.push("");
  }

  lines.push(`## External origins (${report.externalOrigins.length})`, "");
  if (report.externalOrigins.length === 0) {
    lines.push("_None._", "");
  } else {
    lines.push("| Origin | First seen | Count |", "|---|---|---|");
    for (const o of report.externalOrigins) {
      lines.push(`| \`${o.origin}\` | ${o.via} | ${o.count} |`);
    }
    lines.push(
      "",
      "Subresources from unapproved origins were removed. Outbound `<a>` links",
      "were kept. Anything the template genuinely needs should become a vendor",
      "registry entry or a bundle asset, not an allowedOrigins entry.",
      "",
    );
  }

  lines.push(`## Elements removed (${report.elements.length})`, "");
  for (const e of report.elements) lines.push(`- ${e.reason}: \`${e.preview}\``);
  if (report.elements.length === 0) lines.push("_None._");
  lines.push("");

  if (report.warnings.length > 0) {
    lines.push(`## Warnings (${report.warnings.length})`, "");
    for (const w of report.warnings) lines.push(`- ${w}`);
    lines.push("");
  }

  return lines.join("\n");
}