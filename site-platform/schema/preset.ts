// ============================================================================
// site-platform/schema/preset.ts
//
// TEMPLATE PRESETS — the starting point a new site is created from.
//
// A preset IS a SiteDefinition with the domain left blank. It is copied into
// the site at creation and never read again at render time, so editing a preset
// cannot mutate sites already created from it.
//
// Deliberately small. Everything a preset needs to express is already
// expressible in SiteContent and LayeredTheme; the only genuinely new concepts
// are (a) which preset a site started from and (b) which fields are example
// copy that must not ship.
// ============================================================================

import { z } from "zod";
import { SiteMetaSchema, SiteContentSchema, SiteContent } from "./content";
import { LayeredThemeSchema } from "./theme";
import type { ValidationIssue, SiteDefinition  } from "./definition";
import { assignSlugs, resolvePaths } from "./definition";
import { randomUUID } from "node:crypto";
import type { SiteSection } from "./sections";
import { SiteSectionListSchema } from "./sections";

/**
 * Content as authored in a preset. The ONLY deviation from SiteContent is that
 * `meta.fqdn` may be empty — a preset carrying a domain would let two sites be
 * created pointing at the same hostname, and the uniqueness constraint would
 * reject the second at provisioning time with an error that looks nothing like
 * its cause.
 *
 * .extend() on one field rather than a mirrored schema: new fields added to
 * SiteMetaSchema flow through here automatically.
 */
const PresetMetaSchema = SiteMetaSchema.extend({
  fqdn: z.string().default(""),
});

export const PresetContentSchema = SiteContentSchema.extend({
  meta: PresetMetaSchema,
});
export type PresetContent = z.infer<typeof PresetContentSchema>;

export const TemplatePresetSchema = z.object({
  /** Stable within the template. Persisted on the site row for provenance. */
  id: z.string().min(1),
  templateId: z.string().min(1),
  /** Pinned. A preset authored against v1 must not be applied to v2 blind. */
  templateVersion: z.string().min(1),

  name: z.string().min(1),
  description: z.string().optional(),
  /** Path under the template's published prefix. Shown in the preset picker. */
  previewImage: z.string().optional(),

  /** Applied when a site is created without an explicit choice. */
  isDefault: z.boolean().default(false),

  /**
   * Same pair SiteDefinition stores, so materialize is a copy rather than a
   * translation. If a shared theme library lands later, this becomes a themeId
   * plus the same override — SiteDefinition would change identically.
   */
  theme: LayeredThemeSchema,
  themeOverride: z.record(z.string(), z.unknown()).optional(),

  content: PresetContentSchema,

  /**
   * Dotted paths (same `[]` syntax as manifest.requiredContent) that must
   * differ from the preset before publish is allowed.
   *
   * Distinct from requiredContent, which asserts non-EMPTY. This asserts
   * non-EXAMPLE. Both can fail on one field for different reasons, and the
   * messages differ — a user staring at filled-in text being told it's blank
   * is worse than no check.
   *
   * Only list obvious placeholder copy. A seeded overlayOpacity of 0.4 is a
   * fine value to keep; listing it forces busywork.
   */
  mustReplace: z.array(z.string()).default([]),
});
export type TemplatePreset = z.infer<typeof TemplatePresetSchema>;

// ============================================================================
// AUTHORING NOTE — section ids and slugs
// ============================================================================
//
// SectionBaseShape requires `id: z.string().uuid()` and SiteSectionListSchema
// rejects duplicate slugs, so a preset's sections must carry real UUIDs and
// pre-assigned slugs to parse at all.
//
// Those ids are discarded: materializePreset() re-mints every one. They exist
// only so a preset can be validated with the same schema everything else uses.
// The authoring script generates them; nobody types them.
//
// Slugs ARE kept as authored, then re-derived by assignSlugs() after re-minting
// in case a nav label changed.




/**
 * Produce the definition a newly created site starts life with.
 *
 * Returns a DRAFT-shaped object, not a strictly parsed SiteDefinition: until
 * the domain step runs, `meta.fqdn` is empty and would fail `.min(1)`. Publish
 * already strict-parses, so adding a second validation moment here would only
 * mean two places to keep in sync.
 *
 * The section list IS parsed, because the id/slug invariants are precisely what
 * this function can get wrong, and a duplicate slug surfaces at build time as a
 * nav link that jumps to the wrong place rather than as an error.
 */


 
export interface MaterializeInput {
  preset: TemplatePreset;
  /** Injected so tests can pass a counter and assert on stable ids. */
  uuid?: () => string;
  /** Supplied once the wizard's domain step has run. Empty until then. */
  fqdn?: string;
}

export function materializePreset(input: MaterializeInput): SiteDefinition {
  const { preset, uuid = randomUUID, fqdn } = input;
 
  // structuredClone, not spread. A shared nested array between the cached
  // preset and a new site means editing one site mutates the preset for every
  // other request on that instance.
  const content = structuredClone(preset.content);
 
  // Re-mint, then re-slug. Order matters: assignSlugs falls back to the section
  // id when a nav label slugifies to nothing, so it must see the final ids.
  const sections = assignSlugs(
    content.sections.map((section) => remintIds(section, uuid)),
  );
 
  return {
    schemaVersion: content.schemaVersion,
    templateId: preset.templateId,
    templateVersion: preset.templateVersion,
    theme: structuredClone(preset.theme),
    themeOverride: preset.themeOverride
      ? structuredClone(preset.themeOverride)
      : undefined,
    content: {
      ...content,
      meta: { ...content.meta, fqdn: fqdn ?? "" },
      sections: SiteSectionListSchema.parse(sections),
      social: content.social.map((link) => ({ ...link, id: uuid() })),
    },
  } as SiteDefinition;
}
 
/**
 * Fresh identity for a section and every id-bearing child.
 *
 * Section id is `.uuid()` and is the platform's identity key throughout. Two
 * sites sharing one would break per-section media association and make every
 * log line ambiguous.
 *
 * Child collections are listed explicitly. The discriminated union does not
 * make this exhaustive, so a new section type with children needs a line here
 * — and a test, since the failure is silent.
 */
function remintIds(section: SiteSection, uuid: () => string): SiteSection {
  const next = { ...section, id: uuid() } as SiteSection & Record<string, unknown>;
 
  // stats | milestones | items (faq) | cards | images (gallery)
  for (const key of ["stats", "milestones", "items", "cards", "images"]) {
    const children = next[key];
    if (Array.isArray(children)) {
      next[key] = children.map((child: Record<string, unknown>) =>
        "id" in child ? { ...child, id: uuid() } : child,
      );
    }
  }
 
  return next as SiteSection;
}


// ============================================================================
// NEW — the publish gate, as a sibling of validateAgainstManifest
// ============================================================================
 

 
/**
 * Report content still identical to the preset it came from.
 *
 * Returns ValidationIssue[] so the form highlights the offending field by
 * `path` exactly as it already does for manifest violations — one issue list,
 * one rendering path, no second dialect.
 *
 * Called alongside validateAgainstManifest in the form and again at publish.
 */
export function validateAgainstPreset(
  content: SiteContent,
  preset: TemplatePreset,
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
 
  for (const path of preset.mustReplace) {
    // Index by resolved path so a user who deleted or added sections is
    // compared position-for-position against what still exists.
    const seed = new Map(
      resolvePaths(preset.content, path).map((hit) => [hit.path, hit.value]),
    );
 
    for (const hit of resolvePaths(content, path)) {
      if (!seed.has(hit.path)) continue;      // user-added — nothing to compare
      if (!isUnchanged(hit.value, seed.get(hit.path))) continue;
 
      issues.push({
        path: hit.path,
        severity: "error",
        message: "This is still the example content from the template.",
      });
    }
  }
 
  return issues;
}
 
/**
 * Two cases, both cheap.
 *
 * Images: `seedPath` survives only while the image is the one the template
 * shipped. Uploading a replacement produces an asset without it. Deep-comparing
 * instead would report a false positive on a signed-URL refresh and a false
 * negative on a focal-point nudge.
 *
 * Everything else: value equality. A user who edited a field and typed the
 * original back counts as unchanged, which is correct — the question is whether
 * the CONTENT is placeholder, not whether a keystroke occurred.
 */
function isUnchanged(live: unknown, seed: unknown): boolean {
  if (live == null) return false;
 
  if (typeof live === "object" && "seedPath" in (live as object)) {
    return (live as { seedPath?: string }).seedPath ===
           (seed as { seedPath?: string } | undefined)?.seedPath;
  }
 
  return JSON.stringify(live) === JSON.stringify(seed);
}

