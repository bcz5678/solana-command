// ============================================================================
// site-platform/renderer/__tests__/slotted-symmetry.test.ts
//
// apply.ts and extract.ts are deliberate mirrors of one Slot mapping — extract
// is documented as "the slotted apply pass, run backwards" — but nothing in
// the type system enforces that the two agree on what a mode means. Bug 5 was
// exactly that: the ":scope" self-selector was taught to apply.ts but not to
// extract.ts, so writing a leaf-item repeater field worked and reading it back
// silently failed with "No match for ':scope'". This file has two purposes:
//
//   1. A table-driven round trip over every SlotMode that produces a readable
//      value (text, attr, link, image, bgImage, assetUrl — the two
//      removeIf* modes have no value to read back). Write with applySlot,
//      read with extractFromSource, assert the values agree. Should catch the
//      next time one side learns something the other doesn't.
//
//   2. A dedicated ":scope" round trip for a leaf-item repeater — bug 5 itself.
// ============================================================================

import { describe, it, expect } from "vitest";
import { parseHTML } from "linkedom";
import type { Slot, SlottedSpec, ImageAsset, SiteCta } from "@site/schema";
import type { TemplateContext } from "../types";
import { applySlot, type ApplyResult } from "../slotted/apply";
import { extractFromSource } from "../slotted/extract";
import { SlottedElement } from "../slotted/dom";

// applySlot and extractFromSource only ever touch ctx.imageUrl — everything
// else on TemplateContext (definition, manifest, theme, sections, year,
// attributions) is irrelevant to slot application, so a full context isn't
// worth constructing here. The end-to-end render test builds a real one.
function stubCtx(imageUrl: (asset: ImageAsset | undefined) => string): TemplateContext {
  return { imageUrl } as unknown as TemplateContext;
}

function image(overrides: Partial<ImageAsset> = {}): ImageAsset {
  return {
    id: "x",
    stagingKey: "site/x/original.png",
    url: "https://staging.example/x.png",
    alt: "A cat wearing sunglasses",
    decorative: false,
    width: 800,
    height: 600,
    focalX: 0.5,
    focalY: 0.5,
    variants: {},
    ...overrides,
  } as ImageAsset;
}

const RESOLVED_URL = "https://cdn.example/x.png";

interface Case {
  name: string;
  html: string;
  slot: Slot;
  value: unknown;
  /** Assert directly on the applied DOM, before round-tripping through HTML text. */
  assertApplied: (el: SlottedElement) => void;
  /** Assert on the result of feeding the serialized HTML back through extractFromSource. */
  assertExtracted: (result: ReturnType<typeof extractFromSource>) => void;
}

const CASES: Case[] = [
  {
    name: "text",
    html: `<p class="target">placeholder</p>`,
    slot: { selector: ".target", path: "value", mode: "text", all: false, keepFallback: false },
    value: "Hello world",
    assertApplied: (el) => expect(el.textContent).toBe("Hello world"),
    assertExtracted: (r) => expect(r.content.value).toBe("Hello world"),
  },
  {
    name: "attr",
    html: `<a class="target" href="#">link</a>`,
    slot: { selector: ".target", path: "value", mode: "attr", attr: "data-id", all: false, keepFallback: false },
    value: "abc123",
    assertApplied: (el) => expect(el.getAttribute("data-id")).toBe("abc123"),
    assertExtracted: (r) => expect(r.content.value).toBe("abc123"),
  },
  {
    name: "link",
    html: `<a class="target" href="#">CTA</a>`,
    slot: { selector: ".target", path: "value", mode: "link", all: false, keepFallback: false },
    // extract always emits variant:"primary" (apply.ts doesn't preserve
    // variant on the DOM at all — there's nowhere to put it), so applying
    // "primary" keeps the round trip meaningfully comparable.
    value: { label: "Buy now", href: "https://dex.example/buy", external: true, variant: "primary" } as SiteCta,
    assertApplied: (el) => {
      expect(el.getAttribute("href")).toBe("https://dex.example/buy");
      expect(el.textContent).toBe("Buy now");
      expect(el.getAttribute("target")).toBe("_blank");
    },
    assertExtracted: (r) =>
      expect(r.content.value).toEqual({
        label: "Buy now",
        href: "https://dex.example/buy",
        external: true,
        variant: "primary",
      }),
  },
  {
    name: "image",
    html: `<img class="target" src="placeholder.png">`,
    slot: { selector: ".target", path: "value", mode: "image", all: false, keepFallback: false },
    value: image(),
    assertApplied: (el) => {
      expect(el.getAttribute("src")).toBe(RESOLVED_URL);
      expect(el.getAttribute("alt")).toBe("A cat wearing sunglasses");
    },
    // image mode is not read back into `content` — it's collected separately
    // as an imageRef, since the reverse direction needs to re-download and
    // re-variant the asset rather than treat the URL as a content string.
    assertExtracted: (r) => {
      expect(r.imageRefs).toEqual([{ path: "value", src: RESOLVED_URL, alt: "A cat wearing sunglasses" }]);
    },
  },
  {
    name: "bgImage",
    html: `<div class="target"></div>`,
    slot: { selector: ".target", path: "value", mode: "bgImage", all: false, keepFallback: false },
    value: image(),
    assertApplied: (el) => {
      expect(el.getAttribute("style")).toContain(`background-image:url('${RESOLVED_URL}')`);
    },
    // extract's bgImage reader has no `alt` source (it's inline CSS, not an
    // <img>), so it always reports "".
    assertExtracted: (r) => {
      expect(r.imageRefs).toEqual([{ path: "value", src: RESOLVED_URL, alt: "" }]);
    },
  },
  {
    name: "assetUrl",
    html: `<link class="target" rel="icon">`,
    slot: { selector: ".target", path: "value", mode: "assetUrl", all: false, keepFallback: false },
    value: image(),
    assertApplied: (el) => expect(el.getAttribute("href")).toBe(RESOLVED_URL),
    assertExtracted: (r) => expect(r.content.value).toBe(RESOLVED_URL),
  },
];

describe("apply/extract symmetry", () => {
  it.each(CASES)("$name round-trips through applySlot and extractFromSource", (tc) => {
    const { document } = parseHTML(tc.html);
    const target = document.querySelector(".target") as unknown as SlottedElement;

    const applied: ApplyResult = { warnings: [], images: [] };
    const ctx = stubCtx(() => RESOLVED_URL);

    // scope is the document (as a real top-level slot sees it) — querySelectorAll
    // searches descendants, so applying with the target itself as scope would
    // never find ".target" inside itself.
    applySlot(document as never, tc.slot, { value: tc.value }, ctx, applied);
    expect(applied.warnings).toEqual([]);
    tc.assertApplied(target);

    const spec: SlottedSpec = {
      sourceKey: "test",
      slots: [tc.slot],
      repeaters: [],
      bundleAssets: [],
      sanitize: { approvedScripts: [], allowedOrigins: [], allowIframes: false, allowForms: false, stripSelectors: [] },
      metaInsertSelector: "head",
      rewriteAnchors: false,
      sectionNodes: [],
      cssBackgrounds: [],
    };

    const extracted = extractFromSource(document.toString(), spec);
    expect(extracted.warnings).toEqual([]);
    tc.assertExtracted(extracted);
  });
});

describe(":scope symmetry (bug 5)", () => {
  it("round-trips a leaf repeater item's own text — write via applySlot, read via extractFromSource", () => {
    const { document } = parseHTML(`<div class="tag-list"><span class="tag">PLACEHOLDER</span></div>`);
    const item = document.querySelector(".tag") as unknown as SlottedElement;

    const slot: Slot = { selector: ":scope", path: "value", mode: "text", all: false, keepFallback: false };
    const applied: ApplyResult = { warnings: [], images: [] };

    applySlot(item as never, slot, { value: "DeFi" }, stubCtx(() => RESOLVED_URL), applied);
    expect(applied.warnings).toEqual([]);
    expect(item.textContent).toBe("DeFi");

    const spec: SlottedSpec = {
      sourceKey: "test",
      slots: [],
      repeaters: [{ selector: ".tag", path: "tags", max: 50, slots: [slot] }],
      bundleAssets: [],
      sanitize: { approvedScripts: [], allowedOrigins: [], allowIframes: false, allowForms: false, stripSelectors: [] },
      metaInsertSelector: "head",
      rewriteAnchors: false,
      sectionNodes: [],
      cssBackgrounds: [],
    };

    const extracted = extractFromSource(document.toString(), spec);
    expect(extracted.warnings).toEqual([]);
    expect(extracted.content.tags).toEqual([{ value: "DeFi" }]);
  });
});
