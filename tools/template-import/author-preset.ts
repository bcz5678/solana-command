// ============================================================================
// tools/template-import/author-preset.ts
//
// STEP 7 — turn the import drafts into a validated preset.
//
// The first hard gate in the pipeline. Everything upstream produces drafts on
// purpose; this is where PresetContentSchema.parse() runs and a four-pass
// assembly either is or isn't a valid artifact.
//
// Also the first place the preset machinery is exercised end to end:
// materializePreset() then validateAgainstPreset(), asserting every
// mustReplace path actually fires on a fresh site. A misspelled path is
// otherwise a publish gate that silently never fires.
//
// Output: site-platform/renderer/templates/{name}/presets/{id}.ts
// ============================================================================

import { randomUUID } from "node:crypto";
import { parseHTML } from "linkedom";

import {
  PresetContentSchema,
  TemplatePresetSchema,
  LayeredThemeSchema,
  SiteSectionListSchema,
  assignSlugs,
  materializePreset,
  validateAgainstPreset,
  type TemplatePreset,
  type SiteSection,
} from "@site/schema";
import { mergeCore } from "@site/schema";

// ============================================================================
// INPUT
// ============================================================================

export interface AuthorInput {
  templateId: string;
  templateVersion: string;
  presetId: string;
  presetName: string;
  /** .generated/theme.draft.json */
  themeDraft: Record<string, any>;
  /** .generated/content.draft.json */
  contentDraft: Record<string, any>;
  /** source.html — meta still comes from the head. */
  html: string;
  /** overrides.json */
  overrides: {
    anonymize?: Record<string, string>;
    mustReplace?: string[];
  };
  uuid?: () => string;
}

export interface AuthorResult {
  preset: TemplatePreset;
  /** Ready to write as presets/{id}.ts */
  source: string;
  warnings: string[];
}

// ============================================================================
// AUTHOR
// ============================================================================

export function authorPreset(input: AuthorInput): AuthorResult {
  const uuid = input.uuid ?? randomUUID;
  const warnings: string[] = [];

  // --- Theme ---------------------------------------------------------------
  // Extracted values merged OVER the standard base, so a source that never
  // declared a success colour still produces a parseable theme.
  const theme = LayeredThemeSchema.parse({
    id: `${input.templateId}-${input.presetId}`,
    name: `${input.presetName} theme`,
    mode: "dark",
    core: mergeCore(input.themeDraft.core),
    semantic: input.themeDraft.semantic,
    // Tier 3 paths carry a `$` placeholder for the template id until now.
    templates: resolveTier3(input.themeDraft.templates, input.templateId),
  });

  // --- Content -------------------------------------------------------------
  const draft = input.contentDraft;

  const sections = assignSlugs(
    (draft.sections ?? []).map((entry: any, index: number) =>
      buildSection(entry, index, uuid, warnings),
    ),
  );

  const content = PresetContentSchema.parse({
    meta: readMeta(input.html),
    brand: {
      // Never extractable — the logo text is markup the detector reads as a
      // section-less div, and the SEO name is usually decorated.
      name: input.overrides.anonymize?.["brand.name"] ?? "TODO",
    },
    hero: buildHero(draft.hero, warnings),
    sections: SiteSectionListSchema.parse(sections),
    social: (draft.social ?? []).map((s: any) => ({
      id: uuid(),
      platform: s.platform,
      label: s.label ?? s.platform,
      url: s.url,
      showInNav: s.showInNav ?? true,
    })),
    footer: draft.footer ?? { links: [] },
  });

  // --- Preset --------------------------------------------------------------
  const preset = TemplatePresetSchema.parse({
    id: input.presetId,
    templateId: input.templateId,
    templateVersion: input.templateVersion,
    name: input.presetName,
    isDefault: true,
    theme,
    content,
    mustReplace: buildMustReplace(content, input.overrides),
  });

  warnings.push(...roundTrip(preset, uuid));

  return { preset, source: emit(preset), warnings };
}

// ============================================================================
// SECTIONS
// ============================================================================

/**
 * Build a SiteSection of the right shape for its type.
 *
 * Per-type rather than one generic object: each variant of the discriminated
 * union has its own required fields, and a `stats` section with no `stats`
 * array parses but renders empty.
 *
 * KNOWN GAP: array content for non-prose types comes from repeaters, and the
 * repeater pass currently records field SAMPLES (three unique values) rather
 * than per-item values. Until that changes, a stats or timeline section
 * arrives with an empty array and is warned about here.
 */
function buildSection(
  entry: any,
  index: number,
  uuid: () => string,
  warnings: string[],
): SiteSection {
  const base = {
    id: uuid(),
    slug: "",                       // assignSlugs fills this
    order: entry.order ?? index,
    enabled: true,
    navLabel: entry.navLabel ?? entry.title ?? `Section ${index + 1}`,
    showInNav: true,
    kicker: entry.kicker || undefined,
    title: entry.title ?? "TODO",
    backgroundImage: entry.backgroundImage
      ? placeholderImage(entry.backgroundImage, uuid, warnings)
      : undefined,
    overlayOpacity: entry.overlayOpacity ?? undefined,
    overlayDirection: entry.overlayDirection ?? "uniform",
    crossAlign: "start" as const,
  };

  const type = entry.type ?? "prose";

  const empty = (kind: string) => {
    warnings.push(
      `sections[${index}] is "${kind}" but arrived with no items — repeater values ` +
      `are not yet extracted into content. Fill by hand or set type to "prose".`,
    );
  };

  switch (type) {
    case "prose":
      return {
        ...base, type: "prose",
        body: entry.body ?? [],
        cta: entry.cta?.label ? cta(entry.cta) : undefined,
      } as SiteSection;

    case "stats":
      if (!entry.stats?.length) empty("stats");
      return { ...base, type: "stats", intro: entry.intro, stats: entry.stats ?? [] } as SiteSection;

    case "timeline":
      if (!entry.milestones?.length) empty("timeline");
      return { ...base, type: "timeline", intro: entry.intro, milestones: entry.milestones ?? [] } as SiteSection;

    case "faq":
      if (!entry.items?.length) empty("faq");
      return { ...base, type: "faq", intro: entry.intro, items: entry.items ?? [] } as SiteSection;

    case "gallery":
      if (!entry.images?.length) empty("gallery");
      return { ...base, type: "gallery", intro: entry.intro, images: entry.images ?? [], layout: "grid" } as SiteSection;

    case "cards":
      if (!entry.cards?.length) empty("cards");
      return { ...base, type: "cards", intro: entry.intro, cards: entry.cards ?? [] } as SiteSection;

    case "embed":
      warnings.push(`sections[${index}] is "embed" — embedUrl and embedTitle need writing by hand.`);
      return { ...base, type: "embed", embedUrl: "https://example.com", embedTitle: "TODO", aspectRatio: "16/9" } as SiteSection;

    default:
      warnings.push(`sections[${index}] has unknown type "${type}"; treated as prose.`);
      return { ...base, type: "prose", body: entry.body ?? [] } as SiteSection;
  }
}

function buildHero(hero: any, warnings: string[]) {
  if (!hero) {
    warnings.push("No hero found — the preset will not render without one.");
    return { title: "TODO", body: [], ctas: [] };
  }

  // The hero CTA is emitted as found. On meme-coin sources it's frequently a
  // contract-address copy button rather than a link, which belongs in
  // modules.token — but that's a per-template call, not something worth
  // forcing into a shared shape.
  if (hero.ctas?.length) {
    warnings.push(
      `Hero CTA "${hero.ctas[0].label}" emitted as a link. If it's a copy/contract ` +
      `button, move it to modules.token in the preset file.`,
    );
  }

  return {
    kicker: hero.kicker || undefined,
    title: hero.title ?? "TODO",
    body: hero.body ?? [],
    ctas: (hero.ctas ?? []).filter((c: any) => c.label).map(cta),
    backgroundImage: hero.backgroundImage
      ? placeholderImage(hero.backgroundImage, randomUUID, warnings)
      : undefined,
    overlayOpacity: hero.overlayOpacity ?? undefined,
    overlayDirection: hero.overlayDirection ?? "uniform",
    crossAlign: "start" as const,
  };
}

const cta = (c: any) => ({
  label: c.label,
  href: c.href && c.href !== "TODO" ? c.href : "#",
  external: /^https?:/.test(c.href ?? ""),
  variant: "primary" as const,
});

// ============================================================================
// IMAGES
// ============================================================================

/**
 * Placeholder seed image, pending step 6.
 *
 * `width`/`height` are optional in ImageAssetSchema, so they're omitted rather
 * than faked — a wrong intrinsic size causes layout shift, which is worse than
 * none. Step 6 fills them along with `variants`.
 */
function placeholderImage(
  ref: { _sourceUrl?: string },
  uuid: () => string,
  warnings: string[],
) {
  const source = ref._sourceUrl ?? "";
  const name = source.split("/").pop()?.replace(/\.\w+$/, "") ?? "image";

  warnings.push(`Image "${source}" is a placeholder — run step 6 to generate variants.`);

  return {
    id: uuid(),
    seedPath: name,
    stagingKey: `_pending/${source}`,
    url: source,
    alt: "",
    decorative: false,
    focalX: 0.5,
    focalY: 0.5,
    variants: {},
  };
}

// ============================================================================
// MUST REPLACE
// ============================================================================

/**
 * Paths that must differ from the preset before publish.
 *
 * Anonymised paths are included automatically — if a value was identifying
 * enough to need replacing at import, its replacement is placeholder copy by
 * definition.
 *
 * Deliberately NOT included: hero.body and section body copy. A generic launch
 * paragraph is often fine to keep, and forcing a rewrite of prose the customer
 * is happy with is the kind of friction that gets the gate switched off.
 */
function buildMustReplace(
  content: any,
  overrides: AuthorInput["overrides"],
): string[] {
  const paths = new Set<string>([
    "brand.name",
    "meta.title",
    "meta.description",
    "hero.title",
    ...Object.keys(overrides.anonymize ?? {}),
    ...(overrides.mustReplace ?? []),
  ]);

  if (content.social?.length) paths.add("social[].url");
  if (content.modules?.token) paths.add("modules.token.contractAddress");
  if (content.footer?.legal?.companyName) paths.add("footer.legal.companyName");

  return [...paths];
}

// ============================================================================
// ROUND TRIP
// ============================================================================

/**
 * Materialize the preset and confirm every mustReplace path blocks.
 *
 * This is the check worth having. A misspelled path produces a gate that never
 * fires, discovered when a customer's live site shows the example company name.
 */
function roundTrip(preset: TemplatePreset, uuid: () => string): string[] {
  const warnings: string[] = [];

  const site = materializePreset({ preset, uuid });
  const blocked = new Set(validateAgainstPreset(site.content, preset).map((i) => i.path));

  for (const path of preset.mustReplace) {
    const prefix = path.replace("[]", "");
    if (![...blocked].some((b) => b.startsWith(prefix))) {
      warnings.push(
        `mustReplace path "${path}" never fires — it does not resolve to a seeded value.`,
      );
    }
  }

  // Section ids must be unique per materialization, or two sites created from
  // this preset share identities.
  const ids = new Set(site.content.sections.map((s) => s.id));
  if (ids.size !== site.content.sections.length) {
    warnings.push("Section ids collide after materialization — remintIds is not covering a child collection.");
  }

  return warnings;
}

// ============================================================================
// EMIT
// ============================================================================

/**
 * Write the preset as a typed module rather than JSON, for the same reason
 * manifests are code: it fails typecheck when a section type is dropped, and it
 * reviews cleanly in a diff.
 */
function emit(preset: TemplatePreset): string {
  return [
    "// Generated by `import-template preset`. Safe to edit by hand afterwards —",
    "// re-running will overwrite, so copy anything you want to keep.",
    "",
    'import type { TemplatePreset } from "@site/schema";',
    "",
    `export const preset: TemplatePreset = ${JSON.stringify(preset, null, 2)};`,
    "",
  ].join("\n");
}

// ============================================================================
// META
// ============================================================================

/** Belongs in merge.ts once anything but this script needs it. */
function readMeta(html: string) {
  const { document } = parseHTML(html);
  const attr = (selector: string) =>
    document.querySelector(selector)?.getAttribute("content") ?? undefined;

  return {
    fqdn: "",
    title: document.querySelector("title")?.textContent?.trim() ?? "TODO",
    description: attr('meta[name="description"]') ?? "",
    keywords: attr('meta[name="keywords"]'),
    locale: document.documentElement?.getAttribute("lang") ?? "en",
    // Generated sites should not be indexed before launch.
    noindex: true,
  };
}

function resolveTier3(
  templates: Record<string, unknown> | undefined,
  templateId: string,
): Record<string, unknown> | undefined {
  if (!templates) return undefined;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(templates)) {
    out[key === "$" ? templateId : key] = value;
  }
  return out;
}