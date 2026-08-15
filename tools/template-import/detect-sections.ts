// ============================================================================
// tools/template-import/detect-sections.ts
//
// Find the SECTIONS of a one-pager.
//
// Repeated-sibling detection cannot do this: hand-built sections vary — one has
// an h1, another a CTA, a third an extra paragraph — so they never group. What
// does generalise is that a one-pager's nav is a section manifest. Anchor
// fragments name the sections, in order, with labels already attached.
//
// Strategy order:
//   1. Nav anchors -> element ids            (highest confidence, has labels)
//   2. Top-level <section> / <main> children (fallback, no labels)
//   3. Heading-delimited runs                (last resort)
//
// Fields inside each section are read by ROLE, not by repetition: the first
// heading is the title, a short text node before it is the kicker, the
// paragraphs after it are the body.
//
// Build-time only. Never imported by the renderer.
// ============================================================================

import { parseHTML } from "linkedom";
import type { El } from './dom'; 
import { contains } from "./dom";

export interface SectionCandidate {
  sourceId: string;
  selector: string;
  navLabel?: string;
  order: number;
  isHero: boolean;
  confidence: number;
  /** Set when the section has a background whose VALUE lives in CSS. */
  backgroundFrom?: string;
  notes: string[];
}

/**
 * Roles carried by a section. `backgroundFrom` is attached by the caller —
 * it comes from the CSS pass, not from reading the markup.
 */
export interface SectionRoles {
  kicker?: string;
  title?: string;
  body: string[];
  cta?: string;
  backgroundFrom?: string;
}

export interface NavCandidate {
  selector: string;
  /** In-page links, in document order. These name the sections. */
  anchors: Array<{ href: string; label: string }>;
  /** Off-site links that look like social platforms. */
  social: Array<{ href: string; platform: string; iconClass?: string }>;
}

const SOCIAL_HOSTS: Array<[RegExp, string]> = [
  [/(^|\.)x\.com|twitter\.com/i, "x-twitter"],
  [/t\.me|telegram/i, "telegram"],
  [/discord/i, "discord"],
  [/instagram/i, "instagram"],
  [/tiktok/i, "tiktok"],
  [/github/i, "github"],
  [/youtube|youtu\.be/i, "youtube"],
];

// ============================================================================
// NAV
// ============================================================================

/**
 * Read the navigation.
 *
 * Splitting in-page anchors from social links here matters: they land in
 * different parts of SiteContent (sections vs `social[]`) and the source
 * usually interleaves them in one <ul>, as this template does.
 */
export function detectNav(document: El): NavCandidate | null {
  const nav = document.querySelector("nav") ?? document.querySelector("header ul");
  if (!nav) return null;

  const anchors: NavCandidate["anchors"] = [];
  const social: NavCandidate["social"] = [];

  for (const a of Array.from(nav.querySelectorAll("a"))) {
    // Trim: sources routinely carry `href=" #ipo"`, and an untrimmed compare
    // silently drops that section.
    const href = (a.getAttribute("href") ?? "").trim();
    const label = text(a);

    if (href.startsWith("#") && href.length > 1) {
      anchors.push({ href, label });
      continue;
    }

    const match = SOCIAL_HOSTS.find(([pattern]) => pattern.test(href));
    if (match) {
      // Icon-only links have no text; the <i> class is the only clue to which
      // glyph the template expects, and it maps onto SocialLink.platform.
      const icon = a.querySelector("i");
      social.push({
        href,
        platform: match[1],
        iconClass: (typeof icon?.className === "string" ? icon.className : undefined),
      });
    }
  }

  return { selector: cssPath(nav), anchors, social };
}

// ============================================================================
// SECTIONS
// ============================================================================

export function detectSections(html: string): {
  nav: NavCandidate | null;
  sections: SectionCandidate[];
} {
  const { document } = parseHTML(html);
  const doc = document as unknown as El;

  const nav = detectNav(doc);
  const labels = new Map<string, string>();

  for (const anchor of nav?.anchors ?? []) {
    labels.set(anchor.href.slice(1), anchor.label);
  }

  // --- Strategy 1 & 2 combined -------------------------------------------
  // Take every <section>, then fold in any anchor target that isn't one (some
  // sources anchor a <div>). Document order is authoritative for `order`;
  // nav order is often the same but occasionally isn't, and what ships is what
  // the page shows.
  const elements = new Map<El, string>();

  for (const el of Array.from(doc.querySelectorAll("section"))) {
    elements.set(el, el.id ?? "");
  }

  for (const id of labels.keys()) {
    const el = doc.querySelector(`#${cssEscape(id)}`);
    if (el && !elements.has(el)) elements.set(el, id);
  }

  const ordered = Array.from(doc.querySelectorAll("*"))
    .filter((el) => elements.has(el));

  if (ordered.length === 0) {
    return { nav, sections: [] };
  }

  const sections = ordered.map((el, index) => {
    const sourceId = el.id ?? "";
    const notes: string[] = [];

    // Independent of role resolution, which now runs in analyze() after repeater
    // detection. An <h1> anywhere in the section, or first position.
    const isHero = Boolean(el.querySelector("h1")) || index === 0;

    if (!labels.has(sourceId) && sourceId) {
      notes.push(`No nav link targets #${sourceId} — navLabel will need writing.`);
    }
    if (!sourceId) {
      notes.push("Section has no id; the anchor slug will be generated from the nav label.");
    }

    const roles = readRoles(el);

    // Background images on this class of template live in a ::before rule, so
    // the DOM knows a background exists but not what it is. Hand the selector
    // to the stylesheet pass rather than guessing.
    const classes = [...classesOf(el)];
    if (classes.length > 0) {
      roles.backgroundFrom = classes.map((c) => `.${c}::before`).join(", ");
    }

    return {
      sourceId,
      selector: sourceId ? `#${cssEscape(sourceId)}` : cssPath(el),
      navLabel: labels.get(sourceId),
      order: index,
      isHero,
      confidence: labels.has(sourceId) ? 0.95 : sourceId ? 0.8 : 0.6,
      backgroundFrom: classes.length > 0
        ? classes.map((c) => `.${c}::before`).join(", ")
        : undefined,
      notes,
    };
  });

  return { nav, sections };
}

// ============================================================================
// ROLES
// ============================================================================

/**
 * Assign the text-bearing nodes inside a section to content roles.
 *
 * `excluded` holds repeater item elements. Nodes inside them are skipped
 * BEFORE anything is computed, not filtered out afterwards. That ordering is
 * the whole point: a card's <h3> reaching this function becomes the section's
 * heading, and kicker detection — "short leaf text appearing before the
 * heading" — is computed against that heading's index. Filtering the bad
 * entries out later removes the duplicates but leaves the wrong index, so the
 * kicker is still wrong.
 *
 * The heading is resolved here rather than passed in, because "the first
 * heading" is only meaningful once repeater content has been removed from
 * consideration. A section whose only <h3> lives inside a card correctly
 * reports no title.
 */
export function readRoles(section: El, excluded: El[] = []): SectionRoles {
  const roles: SectionRoles = { body: [] };

  // Document order, minus anything a repeater already covers.
  const nodes = Array.from(section.querySelectorAll("*")).filter(
    (node) => !excluded.some((item) => item === node || contains(item, node)),
  );

  // Document order, not tag priority. A section with an <h2> above an <h1> is
  // vanishingly rare, and preferring whichever comes first is more predictable
  // than preferring whichever tag ranks highest.
  const heading = nodes.find((node) => /^h[1-6]$/.test(tag(node))) ?? null;
  const headingIndex = heading ? nodes.indexOf(heading) : -1;

  if (heading) roles.title = relativeSelector(heading, section);

  for (const [i, node] of nodes.entries()) {
    // Nodes inside the heading — a <span> wrapping part of the title — are the
    // heading's own content, not separate roles.
    if (heading && node !== heading && contains(heading, node)) continue;

    const name = tag(node);
    const value = text(node);
    if (!value) continue;

    // A CTA is a link that looks like a button. Checked before the text rules
    // so a short button label isn't mistaken for a kicker, and `continue`d so
    // its inner markup isn't read as body copy.
    if (name === "a") {
      const classes = [...classesOf(node)].join(" ");
      if (!roles.cta && /\b(btn|button|cta)\b/i.test(classes)) {
        roles.cta = relativeSelector(node, section);
      }
      continue;
    }

    // Skip anything inside the claimed CTA — a <div> holding a contract
    // address inside a copy button is not a paragraph.
    if (roles.cta && isInsideSelector(node, section, roles.cta)) continue;

    if (node === heading) continue;

    if (name === "p") {
      roles.body.push(relativeSelector(node, section));
      continue;
    }

    // A short leaf before the heading: the kicker. Both conditions are needed
    // — length alone catches stray labels, position alone catches breadcrumbs.
    const isLeaf = Array.from(node.children ?? []).length === 0;

    if (isLeaf && !roles.kicker && headingIndex >= 0 && i < headingIndex && value.length <= 60) {
      roles.kicker = relativeSelector(node, section);
    }
  }

  return roles;
}

/** True when `node` sits inside the element matched by a section-relative selector. */
function isInsideSelector(node: El, section: El, selector: string): boolean {
  const owner = section.querySelector(selector);
  return Boolean(owner && contains(owner, node));
}

export function sampleRoles(section: El, roles: SectionCandidate["roles"]): Record<string, string> {
  const out: Record<string, string> = {};
  const read = (sel?: string) => (sel ? text(section.querySelector(sel) ?? ({} as El)) : "");

  if (roles.kicker) out.kicker = read(roles.kicker);
  if (roles.title) out.title = read(roles.title);
  if (roles.cta) out.cta = read(roles.cta);
  roles.body.forEach((sel, i) => { out[`body[${i}]`] = truncate(read(sel)); });

  return out;
}

// ============================================================================
// HELPERS
// ============================================================================


function relativeSelector(el: El, root: El): string {
  const parts: string[] = [];
  let cursor: El | null = el;

  while (cursor && cursor !== root) {
    const cls = [...classesOf(cursor)][0];
    if (cls) { parts.unshift(`.${cssEscape(cls)}`); break; }

    const siblings = Array.from(cursor.parentElement?.children ?? [])
      .filter((c) => tag(c) === tag(cursor as El));
    const index = siblings.indexOf(cursor);

    parts.unshift(
      siblings.length > 1 ? `${tag(cursor)}:nth-of-type(${index + 1})` : tag(cursor),
    );
    cursor = cursor.parentElement;
  }

  return parts.join(" ") || tag(el);
}

function cssPath(el: El): string {
  if (el.id) return `#${cssEscape(el.id)}`;
  const cls = [...classesOf(el)][0];
  if (cls) return `.${cssEscape(cls)}`;
  const parent = el.parentElement;
  if (!parent || tag(parent) === "body") return tag(el);
  return `${cssPath(parent)} > ${tag(el)}`;
}

const tag = (el: El): string => (el?.tagName ?? "").toLowerCase();
const text = (el: El): string => (el?.textContent ?? "").replace(/\s+/g, " ").trim();

function classesOf(el: El): Set<string> {
  const raw = el?.className;
  if (typeof raw !== "string") return new Set();
  return new Set(raw.split(/\s+/).filter(Boolean));
}

const cssEscape = (v: string) => v.replace(/([^\w-])/g, "\\$1");
const truncate = (v: string, max = 60) => (v.length > max ? `${v.slice(0, max - 1)}…` : v);