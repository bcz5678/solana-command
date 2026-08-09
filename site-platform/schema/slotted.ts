// ============================================================================
// src/site-platform/schema/slotted.ts
//
// Schema for SLOTTED templates — imported from an already-published site,
// kept structurally intact, with content swapped in by CSS selector.
//
// The tradeoff versus a tokenized port:
//
//   Tokenized  — 4-8h. Full theme control, section reordering, unbounded
//                section count. You generated every byte, so you know exactly
//                what ships.
//   Slotted    — 30-60min. Source look is fixed. Content, images and links are
//                editable; palette and layout are not. Third-party markup is
//                sanitized rather than authored.
//
// Use slotted by default for acquired bundles. Promote to tokenized only when a
// template earns it — many reuses, or a client who actually wants palette control.
//
// Merge these into the schema barrel and add `kind` + `slotted` to
// TemplateManifestSchema.
// ============================================================================

import { z } from "zod";

// ============================================================================
// MANIFEST DISCRIMINANT
// ============================================================================

/**
 * Add to TemplateManifestSchema:
 *
 *   kind: TemplateKindSchema.default("tokenized"),
 *   slotted: SlottedSpecSchema.optional(),
 *
 * plus a .superRefine asserting `slotted` is present when kind is "slotted".
 *
 * Note that a slotted manifest's `usesThemeKeys` should be EMPTY and
 * `customThemeSchema` absent: the source's look is fixed, so surfacing theme
 * controls in the form that change nothing is worse than surfacing none.
 * supportedSectionTypes should list only what the repeaters actually cover.
 */
export const TemplateKindSchema = z.enum(["tokenized", "slotted"]);
export type TemplateKind = z.infer<typeof TemplateKindSchema>;

// ============================================================================
// SLOT MODES
// ============================================================================

/**
 * How a matched node is updated.
 *
 * There is deliberately no "html" mode. Injecting a content field as innerHTML
 * would hand a form field the ability to emit markup on a customer domain,
 * which is the exact hole sanitization exists to close.
 */
export const SlotModeSchema = z.enum([
  /** Replace textContent. The default and the overwhelming majority. */
  "text",

  /** Set a named attribute (requires `attr`). */
  "attr",

  /**
   * SiteCta -> href + label text, plus target/rel when external.
   * Bare `#` when the URL fails safeUrl().
   */
  "link",

  /** ImageAsset -> src, alt, width, height, srcset when variants exist. */
  "image",

  /**
   * ImageAsset -> inline `background-image` on the matched node, plus
   * background-position from the focal point.
   */
  "bgImage",

  /** ImageAsset -> href on a <link rel="icon">/<meta content>. */
  "assetUrl",

  /**
   * Remove the node entirely when the path resolves to empty.
   * For optional regions the source hardcoded — a CTA, a social row.
   */
  "removeIfEmpty",

  /** Inverse: remove the node when the path resolves to something truthy. */
  "removeIfPresent",
]);
export type SlotMode = z.infer<typeof SlotModeSchema>;

// ============================================================================
// SLOT
// ============================================================================

export const SlotSchema = z.object({
  /**
   * CSS selector, resolved against the source document. Must match at most one
   * node unless `all` is set — an ambiguous selector silently updating the
   * wrong element is the main failure mode of this approach, so the renderer
   * reports a warning when a non-`all` selector matches several.
   */
  selector: z.string().min(1),

  /** Apply to every match rather than the first. */
  all: z.boolean().default(false),

  /**
   * Dotted path into SiteContent, e.g. "hero.title",
   * "modules.token.contractAddress", "sections[0].cards[2].title".
   */
  path: z.string().min(1),

  mode: SlotModeSchema.default("text"),

  /** Attribute name, required when mode is "attr". */
  attr: z.string().optional(),

  /**
   * Which manifest imageAspect slot this image occupies, so publish-time
   * cropping targets the right ratio. Defaults to "section".
   */
  imageSlot: z.enum(["hero", "section", "card", "gallery"]).optional(),

  /**
   * Leave the source's own content in place when the path resolves to empty,
   * rather than blanking the node. Useful for placeholder copy the client
   * might legitimately keep.
   */
  keepFallback: z.boolean().default(false),

  /** Author note, surfaced in the mapping editor. */
  note: z.string().optional(),
});
export type Slot = z.infer<typeof SlotSchema>;

// ============================================================================
// REPEATER
// ============================================================================

/**
 * A region the source renders N times — feature cards, roadmap rows, nav links.
 *
 * The FIRST match is treated as the prototype and cloned once per array item;
 * every original sibling match is then removed. So a source with three
 * hardcoded cards can render one card or twelve.
 */
export const RepeaterSchema = z.object({
  /** Selector for the repeating element. First match becomes the prototype. */
  selector: z.string().min(1),

  /** Array path, e.g. "sections[0].cards" or "social". */
  path: z.string().min(1),

  /**
   * Slots applied WITHIN each clone. Selectors are relative to the clone, and
   * paths are relative to the array item.
   */
  slots: z.array(SlotSchema).default([]),

  /** Hard cap, so a runaway array cannot emit ten thousand nodes. */
  max: z.number().int().positive().default(50),

  /** Remove the whole container when the array is empty. */
  containerSelector: z.string().optional(),
});
export type Repeater = z.infer<typeof RepeaterSchema>;

// ============================================================================
// BUNDLE ASSETS
// ============================================================================

/**
 * Static files that shipped with the imported bundle — stylesheets, scripts the
 * reviewer approved, images, fonts.
 *
 * These live in the shared bucket under `_templates/{id}@{version}/` and are
 * copied into each site's prefix at build time, exactly like vendor packages.
 * SRI hashes are verified at import, so a tampered bundle file is caught before
 * it can reach a customer domain.
 */
export const BundleAssetSchema = z.object({
  /** Path as referenced in the source HTML, e.g. "assets/css/style.css". */
  path: z.string().min(1),
  /** sha384 SRI hash of the file bytes. */
  integrity: z.string().regex(/^sha(256|384|512)-/),
  contentType: z.string().min(1),
  /**
   * When true, the file's own content is scanned and rewritten for nested
   * references — a stylesheet's url() targets, for instance.
   */
  rewriteInternalUrls: z.boolean().default(false),
});
export type BundleAsset = z.infer<typeof BundleAssetSchema>;

// ============================================================================
// SANITIZATION POLICY
// ============================================================================

/**
 * What the importer is permitted to keep from third-party markup.
 *
 * Defaults are maximally restrictive. Every relaxation should be justified in
 * the template's PR — this markup runs on a customer domain next to a contract
 * address, and a bundled analytics snippet is indistinguishable from a bundled
 * address-swapper until someone reads it.
 */
export const SanitizePolicySchema = z.object({
  /**
   * Source <script> tags are ALWAYS stripped. Behaviour is re-added as
   * reviewed entries here, emitted as hashed inline scripts.
   */
  approvedScripts: z.array(z.object({
    /** Human label, shown in the strip report. */
    name: z.string(),
    /** The script body, reviewed and committed. No <script> tags. */
    source: z.string(),
  })).optional().default([]),

  /** Origins permitted in the output. Empty means same-origin only. */
  allowedOrigins: z.array(z.string()).optional().default([]),

  /** Keep <iframe> elements. Off by default; each needs a title and sandbox. */
  allowIframes: z.boolean().optional().default(false),

  /** Keep <form> elements. Off by default — a form on a static site posts somewhere. */
  allowForms: z.boolean().optional().default(false),

  /**
   * Selectors removed outright — the source's cookie banner, its own analytics
   * container, a "built by" badge.
   */
  stripSelectors: z.array(z.string()).optional().default([]),
});
export type SanitizePolicy = z.infer<typeof SanitizePolicySchema>;

// ============================================================================
// SLOTTED SPEC
// ============================================================================

export const SlottedSpecSchema = z.object({
  /**
   * Identifier for the registered source document. The HTML itself is imported
   * as a string and registered alongside the renderer, so the render path stays
   * pure — no filesystem reads.
   */
  sourceKey: z.string().min(1),

  /** sha256 of the source HTML, so a silently edited bundle is detectable. */
  sourceHash: z.string().optional(),

  slots: z.array(SlotSchema).default([]),
  repeaters: z.array(RepeaterSchema).default([]),
  bundleAssets: z.array(BundleAssetSchema).default([]),
  // .prefault(), not .default(): every field below is itself
  // .optional().default(...), but .default()'s TS overloads want the fully
  // populated shape regardless — .prefault() is typed against core.input<this>,
  // which correctly treats those fields as omittable. Same runtime result for
  // an all-defaults object like this one; they'd only diverge with a refinement
  // or transform in the mix.
  sanitize: SanitizePolicySchema.prefault({}),

  /**
   * Selector for the <head>-adjacent insertion point for generated meta tags.
   * Existing title/description/OG tags are removed first, so the source's own
   * SEO does not leak into every generated site.
   */
  metaInsertSelector: z.string().default("head"),

  /**
   * Navigation anchors in the source usually point at hardcoded ids. When set,
   * the renderer rewrites in-page hrefs to match generated section slugs.
   */
  rewriteAnchors: z.boolean().default(false),
});
export type SlottedSpec = z.infer<typeof SlottedSpecSchema>;

