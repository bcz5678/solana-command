// ============================================================================
// site-platform/renderer/slotted/extract.ts
//
// The slotted apply pass, run backwards.
//
// A Slot maps `selector -> path` so content can be written INTO a document.
// Every content-bearing mode is directionally symmetric, so the same mapping
// reads content OUT. That means the selector work done to import a bundle also
// produces the preset for a tokenized port of the same page — author once, use
// twice.
//
// Build-time only. Not imported by the renderer, so linkedom stays out of the
// render path and the purity invariant is untouched.
// ============================================================================

import { parseHTML } from "linkedom";
import type { SlottedSpec, Slot, Repeater } from "@site/schema";

export interface ExtractResult {
  /** Partial SiteContent, keyed by the paths the spec declares. */
  content: Record<string, unknown>;
  /** Selectors that matched nothing, or matched several without `all`. */
  warnings: string[];
  /**
   * Image references found, as raw URLs relative to the source. These must be
   * downloaded, run through the standard variant generation, and uploaded to
   * the template's seed prefix before they become ImageAssets.
   */
  imageRefs: Array<{ path: string; src: string; alt: string }>;
}

export function extractFromSource(html: string, spec: SlottedSpec): ExtractResult {
  const { document } = parseHTML(html);

  const result: ExtractResult = { content: {}, warnings: [], imageRefs: [] };

  for (const slot of spec.slots) {
    readSlot(document, slot, slot.path, result);
  }

  for (const repeater of spec.repeaters) {
    readRepeater(document, repeater, result);
  }

  return result;
}

// ============================================================================
// SLOTS
// ============================================================================

function readSlot(
  root: ParentNode,
  slot: Slot,
  path: string,
  result: ExtractResult,
): void {
  // Mirrors apply.ts: linkedom's :scope only works as a descendant filter, so
  // "the root itself" (a leaf repeater item with no selectable child) has to
  // be special-cased rather than queried — an unhandled ":scope" here silently
  // fails every field detect-repeaters.ts emits for a leaf-item repeater.
  const matches = slot.selector === ":scope"
    ? [root as unknown as Element]
    : [...root.querySelectorAll(slot.selector)];

  if (matches.length === 0) {
    result.warnings.push(`No match for "${slot.selector}" (-> ${path})`);
    return;
  }

  // Same warning the apply pass emits. An ambiguous selector reading the wrong
  // element is the main failure mode in both directions.
  if (matches.length > 1 && !slot.all) {
    result.warnings.push(
      `"${slot.selector}" matched ${matches.length} nodes; using the first (-> ${path})`,
    );
  }

  const el = matches[0] as Element;

  switch (slot.mode) {
    case "text":
      // Collapse whitespace — source markup is indented, content is not.
      setPath(result.content, path, el.textContent?.replace(/\s+/g, " ").trim() ?? "");
      return;

    case "attr":
      if (!slot.attr) return;
      setPath(result.content, path, el.getAttribute(slot.attr) ?? "");
      return;

    case "link":
      setPath(result.content, path, {
        label: el.textContent?.trim() ?? "",
        href: el.getAttribute("href") ?? "",
        external: el.getAttribute("target") === "_blank",
        variant: "primary",
      });
      return;

    case "image":
      result.imageRefs.push({
        path,
        src: el.getAttribute("src") ?? "",
        alt: el.getAttribute("alt") ?? "",
      });
      return;

    case "bgImage": {
      // Inline style first, then the stylesheet is a manual lookup — a
      // background set in an external sheet cannot be read without a layout
      // engine, so those get reported rather than guessed at.
      const inline = el.getAttribute("style") ?? "";
      const url = inline.match(/background-image:\s*url\(["']?([^"')]+)/)?.[1];

      if (url) {
        result.imageRefs.push({ path, src: url, alt: "" });
      } else {
        result.warnings.push(
          `bgImage at "${slot.selector}" is not inline; find it in the stylesheet (-> ${path})`,
        );
      }
      return;
    }

    case "assetUrl":
      setPath(
        result.content,
        path,
        el.getAttribute("href") ?? el.getAttribute("content") ?? "",
      );
      return;

    // Presence/absence modes describe how to REMOVE a node. There is no value
    // to read back, so extraction skips them rather than inventing one.
    case "removeIfEmpty":
    case "removeIfPresent":
      return;
  }
}

// ============================================================================
// REPEATERS
// ============================================================================

/**
 * The inverse of prototype-and-clone: every sibling match becomes one array
 * item, with the repeater's inner slots read relative to each.
 *
 * This is where the real leverage is. A source with six hardcoded feature cards
 * yields a six-item array without anyone retyping them.
 */
function readRepeater(
  root: ParentNode,
  repeater: Repeater,
  result: ExtractResult,
): void {
  const matches = [...root.querySelectorAll(repeater.selector)];

  if (matches.length === 0) {
    result.warnings.push(`Repeater "${repeater.selector}" matched nothing (-> ${repeater.path})`);
    return;
  }

  const items = matches.slice(0, repeater.max).map((node, i) => {
    const item: ExtractResult = { content: {}, warnings: [], imageRefs: [] };

    for (const slot of repeater.slots) {
      readSlot(node as ParentNode, slot, slot.path, item);
    }

    // Rewrite child paths so image handling downstream knows which item they
    // belong to. Without this, six cards produce six `image` entries at the
    // same path and five get lost.
    for (const ref of item.imageRefs) {
      result.imageRefs.push({ ...ref, path: `${repeater.path}[${i}].${ref.path}` });
    }
    result.warnings.push(...item.warnings.map((w) => `${repeater.path}[${i}]: ${w}`));

    return item.content;
  });

  setPath(result.content, repeater.path, items);
}

// ============================================================================
// PATHS
// ============================================================================

/**
 * Write to a dotted path, creating intermediate objects and arrays.
 *
 * Note this is the WRITE counterpart to resolvePaths() in the schema package,
 * and it deliberately does not support `[]` — extraction targets a concrete
 * index, never "every element of".
 */
function setPath(root: Record<string, unknown>, path: string, value: unknown): void {
  const parts = path.split(/\.|\[(\d+)\]/).filter((p) => p !== "" && p !== undefined);

  let cursor: Record<string, unknown> = root;

  for (let i = 0; i < parts.length - 1; i++) {
    const key = parts[i];
    const nextIsIndex = /^\d+$/.test(parts[i + 1]);

    if (cursor[key] === undefined) {
      cursor[key] = nextIsIndex ? [] : {};
    }
    cursor = cursor[key] as Record<string, unknown>;
  }

  cursor[parts[parts.length - 1]] = value;
}