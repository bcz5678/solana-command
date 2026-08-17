// ============================================================================
// src/site-platform/renderer/slotted/apply.ts
//
// Applies the slot mapping to a sanitized document: writes content into matched
// nodes, clones repeating regions, and rewrites bundle asset references to the
// site's own published prefix.
// ============================================================================

import type { Slot, Repeater, BundleAsset, SiteContent, ImageAsset, SiteCta }
  from "@site/schema";
import type { TemplateContext, AssetCopy } from "../types";
import { safeUrl } from "../escape";
import { hashedName, IMMUTABLE } from "../assets";
import { SlottedDocument, SlottedElement } from './dom';



export interface ApplyResult {
  warnings: string[];
  /** Images encountered through slots, for the media crop plan. */
  images: Array<{ asset: ImageAsset; slot: "hero" | "section" | "card" | "gallery" }>;
}

// ============================================================================
// PATH RESOLUTION
// ============================================================================

/**
 * Resolve a dotted path with array indices: "sections[0].cards[2].title".
 *
 * Returns undefined for any missing segment rather than throwing — a slot
 * pointing at a field the author has not filled is normal, not an error.
 */
export function resolvePath(root: unknown, path: string): unknown {
  const segments = path.match(/[^.[\]]+/g);
  if (!segments) return undefined;

  let current: unknown = root;

  for (const segment of segments) {
    if (current == null) return undefined;

    if (Array.isArray(current)) {
      const index = Number(segment);
      if (!Number.isInteger(index)) return undefined;
      current = current[index];
    } else if (typeof current === "object") {
      current = (current as Record<string, unknown>)[segment];
    } else {
      return undefined;
    }
  }

  return current;
}

function isEmpty(value: unknown): boolean {
  return (
    value == null ||
    value === "" ||
    (typeof value === "string" && value.trim() === "") ||
    (Array.isArray(value) && value.length === 0)
  );
}

// ============================================================================
// SLOT APPLICATION
// ============================================================================

/**
 * Apply one slot within a scope.
 *
 * `scope` is the document for top-level slots, or a repeater clone for nested
 * ones — which is what makes repeater sub-slots use selectors relative to the
 * cloned node.
 */
export function applySlot(
  scope: SlottedDocument | SlottedElement,
  slot: Slot,
  data: unknown,
  ctx: TemplateContext,
  result: ApplyResult,
): void {

  // linkedom supports :scope in querySelectorAll, but only as a descendant
  // filter — ":scope" alone matches nothing, since the scope element is not its
  // own descendant. Handled here rather than relied on.
  //
  // Only a repeater clone ever emits ":scope" (detect-repeaters.ts only infers
  // it from an item's own leaf text), so `scope` here is always the element,
  // never the top-level SlottedDocument.
  const matches = slot.selector === ":scope"
    ? [scope as SlottedElement]
    : Array.from(scope.querySelectorAll(slot.selector));

  if (matches.length === 0) {
    // The source changed, or the selector was wrong. Loud, because a silently
    // unfilled slot ships a site with the bundle author's placeholder copy.
    result.warnings.push(
      `Slot "${slot.path}" matched no element for selector "${slot.selector}"`,
    );
    return;
  }

  if (matches.length > 1 && !slot.all) {
    // Ambiguous selectors updating the wrong element is the main failure mode
    // of this approach, so it is worth surfacing even though we proceed.
    result.warnings.push(
      `Selector "${slot.selector}" matched ${matches.length} elements; ` +
      `only the first was updated. Set all:true or tighten the selector.`,
    );
  }

  const targets = slot.all ? matches : [matches[0]!];
  const value = resolvePath(data, slot.path);

  for (const el of targets) {
    applyToElement(el, slot, value, ctx, result);
  }
}

function applyToElement(
  el: SlottedElement,
  slot: Slot,
  value: unknown,
  ctx: TemplateContext,
  result: ApplyResult,
): void {
  // ---- Conditional removal, handled before anything writes ----
  if (slot.mode === "removeIfEmpty") {
    if (isEmpty(value)) el.remove();
    return;
  }

  if (slot.mode === "removeIfPresent") {
    if (!isEmpty(value)) el.remove();
    return;
  }

  // ---- Empty handling ----
  if (isEmpty(value)) {
    // keepFallback leaves the source's own copy in place, for placeholder text
    // a client might legitimately keep.
    if (!slot.keepFallback) {
      if (slot.mode === "text") el.textContent = "";
    }
    return;
  }

  switch (slot.mode) {
    // ------------------------------------------------------------------
    // text — textContent assignment, so the DOM escapes for us. This is why
    // there is no "html" mode: a content field must never become markup.
    // ------------------------------------------------------------------
    case "text":
      el.textContent = String(value);
      break;

    case "attr": {
      if (!slot.attr) {
        result.warnings.push(`Slot "${slot.path}" uses mode "attr" without an attr name`);
        break;
      }
      el.setAttribute(slot.attr, String(value));
      break;
    }

    // ------------------------------------------------------------------
    // link — SiteCta or a bare URL string.
    // ------------------------------------------------------------------
    case "link": {
      const cta = value as SiteCta | string;

      if (typeof cta === "string") {
        el.setAttribute("href", safeUrl(cta));
        break;
      }

      el.setAttribute("href", safeUrl(cta.href));
      if (cta.label) el.textContent = cta.label;

      if (cta.external) {
        el.setAttribute("target", "_blank");
        el.setAttribute("rel", "noopener noreferrer");
      } else {
        el.removeAttribute("target");
        el.removeAttribute("rel");
      }
      break;
    }

    // ------------------------------------------------------------------
    // image — src/alt/dimensions. Always via ctx.imageUrl, never asset.url:
    // a staging URL in published output expires and 403s for every visitor.
    // ------------------------------------------------------------------
    case "image": {
      const asset = value as ImageAsset;
      const url = ctx.imageUrl(asset);

      if (!url) {
        result.warnings.push(`Image at "${slot.path}" resolved to no URL`);
        break;
      }

      el.setAttribute("src", url);
      el.setAttribute("alt", asset.decorative ? "" : (asset.alt ?? ""));
      if (asset.decorative) el.setAttribute("aria-hidden", "true");
      if (asset.width) el.setAttribute("width", String(asset.width));
      if (asset.height) el.setAttribute("height", String(asset.height));

      // The source's own srcset would point at the source's own images.
      el.removeAttribute("srcset");

      result.images.push({ asset, slot: slot.imageSlot ?? "section" });
      break;
    }

    // ------------------------------------------------------------------
    // bgImage — inline custom properties rather than a background shorthand,
    // so the source's own background rules (gradients, blend modes) survive.
    // ------------------------------------------------------------------
    case "bgImage": {
      const asset = value as ImageAsset;
      const url = ctx.imageUrl(asset);

      if (!url) {
        result.warnings.push(`Background image at "${slot.path}" resolved to no URL`);
        break;
      }

      const existing = el.getAttribute("style") ?? "";
      const focal = `${((asset.focalX ?? 0.5) * 100).toFixed(1)}% ${((asset.focalY ?? 0.5) * 100).toFixed(1)}%`;

      el.setAttribute(
        "style",
        `${existing}${existing && !existing.trimEnd().endsWith(";") ? ";" : ""}` +
        `background-image:url('${url}');background-position:${focal};` +
        `background-size:cover;`,
      );

      result.images.push({ asset, slot: slot.imageSlot ?? "section" });
      break;
    }

    case "assetUrl": {
      const asset = value as ImageAsset;
      const url = ctx.imageUrl(asset);
      if (!url) break;

      // <link rel="icon" href> vs <meta property="og:image" content>
      el.setAttribute(el.tagName.toLowerCase() === "meta" ? "content" : "href", url);
      result.images.push({ asset, slot: slot.imageSlot ?? "card" });
      break;
    }
  }
}

// ============================================================================
// REPEATERS
// ============================================================================

/**
 * Clone a repeating region once per array item.
 *
 * The first match is the prototype; remaining original siblings are removed.
 * So a source with three hardcoded feature cards renders one card or twelve.
 */
export function applyRepeater(
  doc: SlottedDocument,
  repeater: Repeater,
  content: SiteContent,
  ctx: TemplateContext,
  result: ApplyResult,
): void {
  const matches = doc.querySelectorAll(repeater.selector);

  if (matches.length === 0) {
    result.warnings.push(
      `Repeater "${repeater.path}" matched no element for "${repeater.selector}"`,
    );
    return;
  }

  const raw = resolvePath(content, repeater.path);
  const items = Array.isArray(raw) ? raw : [];

  // ---- Empty array ----
  if (items.length === 0) {
    if (repeater.containerSelector) {
      doc.querySelector(repeater.containerSelector)?.remove();
    } else {
      for (const el of matches) el.remove();
    }
    return;
  }

  const prototype = matches[0]!;
  const parent = prototype.parentNode;

  if (!parent) {
    result.warnings.push(`Repeater prototype "${repeater.selector}" has no parent node`);
    return;
  }

  // Cap before cloning. Without this a runaway array emits thousands of nodes
  // and the render never returns.
  const capped = items.slice(0, repeater.max);
  if (items.length > repeater.max) {
    result.warnings.push(
      `Repeater "${repeater.path}" truncated from ${items.length} to ${repeater.max} items`,
    );
  }

  for (const item of capped) {
    const clone = prototype.cloneNode(true);

    // Sub-slot selectors are relative to the clone; sub-slot paths are relative
    // to the array item.
    for (const slot of repeater.slots) {
      applySlot(clone as unknown as SlottedElement, slot, item, ctx, result);
    }

    parent.insertBefore(clone, prototype);
  }

  // Remove every original, prototype included. Done last so insertBefore had a
  // stable reference throughout.
  for (const el of matches) el.remove();
}

// ============================================================================
// BUNDLE ASSET REWRITING
// ============================================================================

export interface BundleRewriteResult {
  copies: AssetCopy[];
  warnings: string[];
}

/**
 * Rewrite references to bundled files so they resolve from the site's own
 * published prefix, and emit the copy instructions to put them there.
 *
 *   assets/css/style.css  ->  /assets/style.a3f9c2.css
 *
 * Content-hashed, so these are immutable and never need invalidating — which
 * is what keeps a rebuild's invalidation list at two paths.
 */
export function rewriteBundleAssets(
  doc: SlottedDocument,
  assets: BundleAsset[],
  templateKey: string,
  s3Prefix: string,
): BundleRewriteResult {
  const copies: AssetCopy[] = [];
  const warnings: string[] = [];
  const urlMap = new Map<string, string>();

  for (const asset of assets) {
    const file = hashedName(asset.path, asset.integrity);
    const published = `/assets/${file}`;

    urlMap.set(asset.path, published);
    // Sources reference the same file as "assets/x.css", "./assets/x.css" and
    // "/assets/x.css" interchangeably; normalise all three.
    urlMap.set(`./${asset.path}`, published);
    urlMap.set(`/${asset.path}`, published);

    copies.push({
      sourceKey: `_templates/${templateKey}/${asset.path}`,
      destKey: `${s3Prefix}assets/${file}`,
      contentType: asset.contentType,
      cacheControl: IMMUTABLE,
    });
  }

  const ATTRS: Array<[string, string]> = [
    ["link[href]", "href"],
    ["img[src]", "src"],
    ["source[src]", "src"],
    ["video[src]", "src"],
    ["video[poster]", "poster"],
    ["audio[src]", "src"],
    ["use[href]", "href"],
  ];

  for (const [selector, attr] of ATTRS) {
    for (const el of doc.querySelectorAll(selector)) {
      const raw = el.getAttribute(attr);
      if (!raw || /^(https?:|data:|#|\/\/)/i.test(raw)) continue;

      const mapped = urlMap.get(raw);

      if (mapped) {
        el.setAttribute(attr, mapped);
      } else {
        // A local reference with no bundle entry will 404 on the live site.
        // Reporting it here beats discovering it in production.
        warnings.push(
          `Unmapped local reference "${raw}" in ${selector} — add it to bundleAssets`,
        );
      }
    }
  }

  // Inline styles referencing bundled images: url('assets/bg.jpg')
  for (const el of doc.querySelectorAll("style")) {
    let css = el.textContent ?? "";
    let changed = false;

    for (const [from, to] of urlMap) {
      const pattern = new RegExp(
        `url\\(\\s*['"]?${from.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}['"]?\\s*\\)`,
        "g",
      );
      if (pattern.test(css)) {
        css = css.replace(pattern, `url('${to}')`);
        changed = true;
      }
    }

    if (changed) el.textContent = css;
  }

  return { copies, warnings };
}