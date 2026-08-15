// ============================================================================
// tools/template-import/detect-repeaters.ts
//
// Find the regions of an arbitrary page that repeat, without knowing anything
// about how it was built.
//
// Detection is deliberately CLASS-AGNOSTIC and TEXT-AGNOSTIC: two unrelated
// originals share no naming convention, so the only thing that generalises is
// shape. An element's skeleton is its tag plus its descendant tag structure to
// a fixed depth. Three or more siblings with the same skeleton is a repeater.
//
// Note the asymmetry: classes are ignored for DETECTION but preferred for the
// emitted SELECTOR, because `.feature-card` survives a bundle update and
// `div:nth-of-type(3)` does not.
//
// Build-time only. Never imported by the renderer.
// ============================================================================

import { parseHTML } from "linkedom";
import type { El } from './dom';
  
import  { 
  kids, 
  tag, 
  text, 
  classesOf, 
  cssEscape, 
  truncate, 
  cssPath, 
  relativeSelector, 
  contains 
} from './dom'; 

// ============================================================================
// TYPES
// ============================================================================



export type FieldKind = "text" | "image" | "link";

export type FieldHint =
  | "numeric" | "date" | "question" | "short" | "long" | "url";

export interface FieldCandidate {
  /** Selector RELATIVE to a repeater item — drops straight into Repeater.slots. */
  selector: string;
  kind: FieldKind;
  /** Suggested Slot.mode. */
  mode: "text" | "image" | "link";
  /**
   * True when every item carries the identical value. That's chrome — a "Read
   * more" label, a decorative icon — not a content field. Distinguishing these
   * is most of what stops the reviewer deleting rows by hand.
   */
  constant: boolean;
  /** Present in some items but not all. Maps to an optional schema field. */
  optional: boolean;
  hint?: FieldHint;
  samples: string[];
}

export type SectionTypeHint =
  | "stats" | "timeline" | "faq" | "gallery" | "cards" | "prose"
  | "nav" | "social";

export interface RepeaterCandidate {
  id: string;
  /** For RepeaterSchema.selector. */
  selector: string;
  /** For RepeaterSchema.containerSelector. */
  containerSelector: string;
  count: number;
  /** 0..1. Below ~0.5 means look at this before trusting it. */
  confidence: number;
  fields: FieldCandidate[];
  sectionTypeHint: SectionTypeHint;
  /** Set when this candidate's items sit inside another candidate's item. */
  nestedIn?: string;
  notes: string[];
}

export interface DetectOptions {
  /** Two siblings is a coincidence; three is a pattern. */
  minRun?: number;
  /** Skeleton comparison depth. Deeper is stricter. */
  skeletonDepth?: number;
  /** Matches RepeaterSchema.max — a runaway array cannot emit ten thousand nodes. */
  maxItems?: number;
}

// Structural noise, form controls, and vector internals. A run of <path>
// elements is a logo, not a roadmap.
const SKIP_TAGS = new Set([
  "script", "style", "br", "hr", "option", "path", "g", "defs",
  "circle", "rect", "polygon", "line", "meta", "link", "source",
]);

// ============================================================================
// ENTRY POINT
// ============================================================================

export function detectRepeaters(
  html: string,
  options: DetectOptions = {},
): RepeaterCandidate[] {
   const { document } = parseHTML(html);
  return detectRepeatersIn(document.body as unknown as El, document as unknown as El, options);
};

/** Scoped pass. `document` stays separate because selector verification —
 *  "does this class match more nodes than my group?" — must check the whole
 *  document, not just the subtree. */
export function detectRepeatersIn(
  root: El,
  document: El,
  options: DetectOptions = {},
): RepeaterCandidate[] {
  const { minRun = 3, skeletonDepth = 3, maxItems = 50 } = options;
  if (!root) return [];

  const candidates: RepeaterCandidate[] = [];
  let seq = 0;

  // Every element is a potential container — root included. walk() itself is
  // descendants-only (right for the old whole-document entry point, where
  // <body> is never itself the repeater), but detectRepeatersIn() is now
  // called scoped to a single section, and a section's OWN direct children
  // being the repeating group — three sibling .card divs right under
  // <section> — is the common case, not an edge case. Excluding root here
  // silently missed exactly that.
  for (const container of [root, ...walk(root)]) {
    const children = kids(container).filter((c) => !SKIP_TAGS.has(tag(c)));
    if (children.length < minRun) continue;

    // Strict grouping first. Fall back to a looser tag-multiset comparison only
    // if nothing reaches minRun — an optional badge on one card shouldn't
    // break the group, but loosening by default over-matches badly.
    let groups = groupBySkeleton(children, (el) => skeleton(el, skeletonDepth));
    let fuzzy = false;

    if (!groups.some((g) => g.length >= minRun)) {
      groups = groupBySkeleton(children, (el) => fuzzySkeleton(el, skeletonDepth));
      fuzzy = true;
    }

    for (const group of groups) {
      if (group.length < minRun) continue;

      const items = group.slice(0, maxItems);
      const notes: string[] = [];

      if (fuzzy) {
        notes.push("Matched on a relaxed skeleton — items are not structurally identical.");
      }
      if (group.length > maxItems) {
        notes.push(`Truncated: ${group.length} matches, capped at ${maxItems}.`);
      }
      if (group.length < children.length) {
        notes.push(
          `${children.length - group.length} sibling(s) did not match — ` +
          `check whether one is a heading or a differently-shaped item.`,
        );
      }

      const fields = inferFields(items);
      const { selector, selectorConfidence, selectorNote } =
        buildItemSelector(items, container, document as unknown as El);

      if (selectorNote) notes.push(selectorNote);

      candidates.push({
        id: `rep-${++seq}`,
        selector,
        containerSelector: cssPath(container),
        count: items.length,
        confidence: score({ fuzzy, count: items.length, fields, selectorConfidence }),
        fields,
        sectionTypeHint: inferSectionType(items, fields),
        notes,
      });
    }
  }

  return markNesting(candidates, document as unknown as El);
}

// ============================================================================
// TRAVERSAL
// ============================================================================

/** Depth-first, descendants only — root itself is never a repeater container. */
function* walk(root: El): Generator<El> {
  for (const child of kids(root)) {
    yield child;
    yield* walk(child);
  }
}

// ============================================================================
// SKELETONS
// ============================================================================

/**
 * Tag plus ordered descendant structure to `depth`. Classes, ids, attributes
 * and text are all excluded — none of them generalise across originals.
 *
 *   <div><h3/><p/></div>  ->  "div(h3,p)"
 */
function skeleton(el: El, depth: number): string {
  const name = tag(el);
  if (depth <= 0) return name;

  const children = kids(el).filter((c) => !SKIP_TAGS.has(tag(c)));
  if (children.length === 0) return name;

  return `${name}(${children.map((c) => skeleton(c, depth - 1)).join(",")})`;
}

/**
 * Order- and count-insensitive: the SET of descendant tags. Tolerates an item
 * with an extra badge or a missing subtitle, at the cost of matching things
 * that merely happen to contain the same element types.
 */
function fuzzySkeleton(el: El, depth: number): string {
  const tags = new Set<string>();

  (function collect(node: El, d: number) {
    if (d <= 0) return;
    for (const child of kids(node)) {
      if (SKIP_TAGS.has(tag(child))) continue;
      tags.add(tag(child));
      collect(child, d - 1);
    }
  })(el, depth);

  return `${tag(el)}~${[...tags].sort().join(",")}`;
}

function groupBySkeleton(elements: El[], key: (el: El) => string): El[][] {
  const groups = new Map<string, El[]>();

  for (const el of elements) {
    const k = key(el);
    const existing = groups.get(k);
    if (existing) existing.push(el);
    else groups.set(k, [el]);
  }

  return [...groups.values()];
}

// ============================================================================
// FIELD INFERENCE
// ============================================================================

/**
 * Find the value-bearing nodes inside each item, align them across items by
 * relative selector, and classify.
 *
 * Alignment is what makes `constant` computable, and `constant` is the signal
 * that separates a content field from boilerplate. Without it every "Learn
 * more" link is proposed as an editable field and the reviewer deletes twelve
 * rows per template.
 */
function inferFields(items: El[]): FieldCandidate[] {
  const perItem = items.map((item) => collectValues(item, item));

  // Union of selectors, preserving first-seen order so the emitted field list
  // reads in document order rather than hash order.
  const order: string[] = [];
  const seen = new Set<string>();
  for (const values of perItem) {
    for (const { selector } of values) {
      if (!seen.has(selector)) { seen.add(selector); order.push(selector); }
    }
  }

  const fields: FieldCandidate[] = [];

  for (const selector of order) {
    const hits = perItem.map((values) => values.find((v) => v.selector === selector));
    const present = hits.filter(Boolean) as ValueNode[];
    if (present.length === 0) continue;

    const values = present.map((h) => h.value);
    const unique = new Set(values);

    fields.push({
      selector,
      kind: present[0].kind,
      mode: present[0].kind,
      constant: unique.size === 1 && present.length === items.length,
      optional: present.length < items.length,
      hint: hintFor(present[0].kind, values),
      samples: [...unique].slice(0, 3),
    });
  }

  return fields;
}

interface ValueNode {
  selector: string;
  kind: FieldKind;
  value: string;
}

/** Leaf text, images and links, with a selector relative to the item root. */
function collectValues(node: El, itemRoot: El): ValueNode[] {
  const out: ValueNode[] = [];

  for (const child of kids(node)) {
    if (SKIP_TAGS.has(tag(child))) continue;

    const selector = relativeSelector(child, itemRoot);

    if (tag(child) === "img") {
      out.push({
        selector,
        kind: "image",
        value: child.getAttribute("src") ?? "",
      });
      continue;
    }

    if (tag(child) === "a") {
      out.push({
        selector,
        kind: "link",
        value: `${child.getAttribute("href") ?? ""}|${text(child)}`,
      });
      // Don't descend — the link's own text is the value. Descending would
      // also emit the <span> inside it as a separate text field.
      continue;
    }

    const childElements = kids(child).filter((c) => !SKIP_TAGS.has(tag(c)));

    if (childElements.length === 0) {
      const value = text(child);
      if (value) out.push({ selector, kind: "text", value });
      continue;
    }

    out.push(...collectValues(child, itemRoot));
  }

  return out;
}

function hintFor(kind: FieldKind, values: string[]): FieldHint | undefined {
  if (kind === "image") return undefined;
  if (kind === "link") return "url";

  const sample = values.find(Boolean) ?? "";

  // Roadmap markers are the highest-value hint: they're what distinguishes a
  // timeline from a generic card grid, and the two render very differently.
  if (/^(Q[1-4]\b|phase\s*\d|step\s*\d|\d{4}\b)/i.test(sample)) return "date";
  if (values.every((v) => /^[\d.,]+\s*[%+xkKmMbB]?$/.test(v) || /^(∞|TBA|TBD)$/i.test(v))) {
    return "numeric";
  }
  if (values.filter((v) => v.trim().endsWith("?")).length >= values.length / 2) {
    return "question";
  }
  return sample.length <= 40 ? "short" : "long";
}

// ============================================================================
// SECTION TYPE
// ============================================================================

function inferSectionType(items: El[], fields: FieldCandidate[]): SectionTypeHint {
  const content = fields.filter((f) => !f.constant);
  const hints = new Set(content.map((f) => f.hint));

  // Nav and social are links-only runs. Worth separating: neither becomes a
  // section, and the nav in particular is a section manifest — its href
  // fragments name every section on the page, in order.
  const linkOnly = content.length > 0 && content.every((f) => f.kind === "link");
  if (linkOnly) {
    const hrefs = items.map((i) => i.getAttribute("href")
      ?? (kids(i).find((c) => tag(c) === "a")?.getAttribute("href") ?? ""));
    if (hrefs.filter((h) => h.startsWith("#")).length >= hrefs.length / 2) return "nav";
    if (hrefs.some((h) => /x\.com|twitter|telegram|discord|instagram|tiktok|github/i.test(h))) {
      return "social";
    }
    return "nav";
  }

  if (hints.has("date")) return "timeline";
  if (hints.has("question")) return "faq";

  const images = content.filter((f) => f.kind === "image");
  const texts = content.filter((f) => f.kind === "text");

  if (images.length > 0 && texts.length === 0) return "gallery";

  // A short numeric paired with a short label is the stat-block signature.
  if (texts.length === 2 && content.some((f) => f.hint === "numeric")) return "stats";

  if (images.length > 0) return "cards";
  if (texts.length >= 2) return "cards";
  return "prose";
}

// ============================================================================
// SELECTORS
// ============================================================================

/**
 * Build a selector for the repeater items.
 *
 * Prefers a class shared by every item, verified against the whole document —
 * a class that also matches elements outside the group would silently pull in
 * unrelated nodes at apply time. Falls back to a child combinator on the
 * container, which is correct but brittle if the bundle is later updated.
 */
function buildItemSelector(
  items: El[],
  container: El,
  document: El,
): { selector: string; selectorConfidence: number; selectorNote?: string } {
  const shared = [...classesOf(items[0])].filter((cls) =>
    items.every((item) => classesOf(item).has(cls)),
  );

  for (const cls of shared.sort((a, b) => a.length - b.length)) {
    const selector = `.${cssEscape(cls)}`;
    const matches = document.querySelectorAll(selector).length;

    if (matches === items.length) {
      return { selector, selectorConfidence: 1 };
    }
    if (matches > items.length) {
      // Still usable when scoped, and much better than nth-of-type.
      return {
        selector: `${cssPath(container)} > ${selector}`,
        selectorConfidence: 0.8,
        selectorNote: `".${cls}" matches ${matches} nodes document-wide; scoped to the container.`,
      };
    }
  }

  return {
    selector: `${cssPath(container)} > ${tag(items[0])}`,
    selectorConfidence: 0.4,
    selectorNote:
      "No shared class on the items — this selector is structural and will " +
      "break if the source markup changes.",
  };
}




// ============================================================================
// SCORING & NESTING
// ============================================================================

function score(input: {
  fuzzy: boolean;
  count: number;
  fields: FieldCandidate[];
  selectorConfidence: number;
}): number {
  let value = 0.5;

  if (!input.fuzzy) value += 0.2;
  if (input.count >= 4) value += 0.1;

  value += (input.selectorConfidence - 0.5) * 0.4;

  // Every field identical across items means the repetition is decorative —
  // a row of dividers, a repeated icon. Not a content array.
  const varying = input.fields.filter((f) => !f.constant).length;
  if (varying === 0) value -= 0.35;
  else if (varying >= 2) value += 0.1;

  return Math.max(0, Math.min(1, Number(value.toFixed(2))));
}

/**
 * Flag candidates whose items live inside another candidate's items.
 *
 * Both are usually real — an outer "sections" repeater containing an inner
 * "cards" repeater — and RepeaterSchema supports the nesting via relative
 * paths. Surfacing the relationship is what stops a reviewer mapping the inner
 * one to a top-level path.
 */
function markNesting(candidates: RepeaterCandidate[], document: El): RepeaterCandidate[] {
  return candidates.map((candidate) => {
    const own = Array.from(document.querySelectorAll(candidate.selector));
    if (own.length === 0) return candidate;

    for (const other of candidates) {
      if (other.id === candidate.id) continue;

      const outer = Array.from(document.querySelectorAll(other.selector));
      const contained = own.every((node) => outer.some((o) => contains(o, node)));

      if (contained) return { ...candidate, nestedIn: other.id };
    }
    return candidate;
  });
}


// ============================================================================
// REPORT
// ============================================================================

/** Console output for the CLI. Mirrors the strip report's format. */
export function formatReport(candidates: RepeaterCandidate[]): string {
  if (candidates.length === 0) return "No repeating regions found.\n";

  const ranked = [...candidates].sort((a, b) => b.confidence - a.confidence);
  const lines: string[] = [`Found ${ranked.length} repeating region(s).\n`];

  for (const c of ranked) {
    lines.push(
      `${c.id}  ${c.sectionTypeHint.toUpperCase()}  ` +
      `${c.count} items  confidence ${c.confidence}` +
      (c.nestedIn ? `  (nested in ${c.nestedIn})` : ""),
    );
    lines.push(`  selector:  ${c.selector}`);
    lines.push(`  container: ${c.containerSelector}`);

    for (const f of c.fields) {
      const flags = [
        f.constant ? "CONSTANT" : null,
        f.optional ? "optional" : null,
        f.hint,
      ].filter(Boolean).join(" ");

      lines.push(`    ${f.selector.padEnd(28)} ${f.mode.padEnd(6)} ${flags}`);
      if (!f.constant) lines.push(`      e.g. ${f.samples.map(truncate).join(" | ")}`);
    }

    for (const note of c.notes) lines.push(`  ! ${note}`);
    lines.push("");
  }

  return lines.join("\n");
}

