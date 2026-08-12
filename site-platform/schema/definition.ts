
import { z } from "zod";
import { ImageAsset } from "./primitives";
import { SiteContent, SiteContentSchema } from "./content";
import { TemplateManifest } from "./manifest";
import { LayeredThemeSchema } from "./theme";

/** Bump on any breaking shape change. Persisted with every stored payload. */
export const SCHEMA_VERSION = 1 as const;


// ============================================================================
// SECTION 7 — src/definition.ts
//
// The payload stored verbatim in private.site_versions.definition and passed
// to the renderer. Snapshot semantics: templateVersion is pinned so a rebuild
// two years from now reproduces the same output after the template evolves.
// ============================================================================

export const SiteDefinitionSchema = z.object({
  schemaVersion: z.number().int().default(SCHEMA_VERSION),
  templateId: z.string(),
  templateVersion: z.string(),
  theme: LayeredThemeSchema,
  /** Per-site deviations from the shared theme. Merged after `extends`. */
  themeOverride: z.record(z.string(), z.unknown()).optional(),
  content: SiteContentSchema,
});
export type SiteDefinition = z.infer<typeof SiteDefinitionSchema>;


// ---- Draft shape guard ----
//
// NOT SiteDefinitionSchema.partial(). That is shallow — `content` becomes
// optional but its own required keys do not, so a form with only meta.title
// filled in fails and every keystroke errors.
//
// A deeply-partial mirror would be a second schema that drifts from the first.
// The draft column is jsonb, the draft is re-parsed before any render, and
// publish parses strictly — so the only thing worth checking here is that this
// is plausibly a definition and not a bug or an abuse vector.
export const DraftGuard = z.object({
  templateId: z.string().optional(),
  templateVersion: z.string().optional(),
  theme: z.unknown().optional(),
  content: z.unknown().optional(),
  themeOverride: z.unknown().optional(),
  schemaVersion: z.number().int().optional(),
}).passthrough();




// ============================================================================
// SECTION 8 — src/helpers.ts
// ============================================================================

export function slugify(input: string | null | undefined): string {
  return (input ?? "")
    .toLowerCase()
    .trim()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")   // strip combining accent marks
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/[\s_-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * Assign unique slugs across a section list.
 *
 * Two sections labelled "About" both slugify to `about`, producing duplicate
 * element ids and a nav link that jumps to whichever the browser found first.
 * Dedupe deterministically by `order` so slugs stay stable across rebuilds, and
 * fall back to the section id when a label slugifies to nothing (emoji-only
 * labels are the common case — the stress fixture covers it).
 */
export function assignSlugs<T extends { id: string; navLabel: string; order: number }>(
  sections: T[],
): Array<T & { slug: string }> {
  const seen = new Map<string, number>();

  return [...sections]
    .sort((a, b) => a.order - b.order)
    .map((section) => {
      const base = slugify(section.navLabel) || `section-${section.id.slice(0, 8)}`;
      const count = seen.get(base) ?? 0;
      seen.set(base, count + 1);
      return { ...section, slug: count === 0 ? base : `${base}-${count + 1}` };
    });
}

export interface ValidationIssue {
  path: string;
  severity: "error" | "warning";
  message: string;
}

/** Resolve a dotted path, supporting `[]` as "every element of this array". */
export function resolvePaths(root: unknown, path: string): Array<{ path: string; value: unknown }> {
  const segments = path.split(".");
  let frontier: Array<{ path: string; value: unknown }> = [{ path: "", value: root }];

  for (const segment of segments) {
    const isArray = segment.endsWith("[]");
    const key = isArray ? segment.slice(0, -2) : segment;
    const next: Array<{ path: string; value: unknown }> = [];

    for (const node of frontier) {
      const value = (node.value as Record<string, unknown> | null | undefined)?.[key];
      const nodePath = node.path ? `${node.path}.${key}` : key;

      if (isArray && Array.isArray(value)) {
        value.forEach((item, i) => next.push({ path: `${nodePath}[${i}]`, value: item }));
      } else {
        next.push({ path: nodePath, value });
      }
    }
    frontier = next;
  }
  return frontier;
}

/**
 * Validate content against a template's declared capabilities.
 *
 * Run on every change in the creation form to drive inline errors, and again in
 * the build pipeline as a publish gate. Returns structured issues rather than
 * throwing, so the form can highlight the offending field via `path`.
 */
export function validateAgainstManifest(
  content: SiteContent,
  manifest: TemplateManifest,
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const active = content.sections.filter((s) => s.enabled);

  // --- Section count bounds ---
  if (active.length < manifest.sectionCount.min) {
    issues.push({
      path: "sections", severity: "error",
      message: `${manifest.name} needs at least ${manifest.sectionCount.min} sections; ${active.length} enabled.`,
    });
  }
  if (active.length > manifest.sectionCount.max) {
    issues.push({
      path: "sections", severity: "error",
      message: `${manifest.name} supports at most ${manifest.sectionCount.max} sections; ${active.length} enabled.`,
    });
  }

  // --- Section type support ---
  active.forEach((section, i) => {
    if (!manifest.supportedSectionTypes.includes(section.type)) {
      issues.push({
        path: `sections[${i}].type`, severity: "error",
        message: `${manifest.name} cannot render a "${section.type}" section.`,
      });
    }
  });

  // --- Module support ---
  for (const key of Object.keys(content.modules ?? {})) {
    if (!manifest.supportsModules.includes(key)) {
      issues.push({
        path: `modules.${key}`, severity: "warning",
        message: `${manifest.name} does not render the "${key}" module; it will be omitted.`,
      });
    }
  }

  // --- Required content paths ---
  for (const required of manifest.requiredContent) {
    for (const hit of resolvePaths(content, required)) {
      const empty =
        hit.value == null ||
        (typeof hit.value === "string" && hit.value.trim() === "") ||
        (Array.isArray(hit.value) && hit.value.length === 0);

      if (empty) {
        issues.push({
          path: hit.path, severity: "error",
          message: `${manifest.name} requires this field.`,
        });
      }
    }
  }

  // --- Accessibility: non-decorative images need alt text ---
  const images: Array<{ path: string; image?: ImageAsset }> = [
    { path: "hero.backgroundImage", image: content.hero.backgroundImage },
    ...active.map((s, i) => ({ path: `sections[${i}].backgroundImage`, image: s.backgroundImage })),
  ];

  for (const { path, image } of images) {
    if (image && !image.decorative && !image.alt.trim()) {
      issues.push({
        path: `${path}.alt`, severity: "warning",
        message: "Image has no alt text. Mark it decorative if it carries no meaning.",
      });
    }
    // --- Contrast risk: photo background under a thin scrim ---
    if (image && (image as ImageAsset).url) {
      const opacity = path.startsWith("hero")
        ? content.hero.overlayOpacity
        : active[Number(path.match(/\[(\d+)\]/)?.[1] ?? -1)]?.overlayOpacity;
      if ((opacity ?? 0) < 0.25) {
        issues.push({
          path: `${path === "hero.backgroundImage" ? "hero" : path.replace(".backgroundImage", "")}.overlayOpacity`,
          severity: "warning",
          message: "Low overlay opacity over a photo — text may be unreadable on light images.",
        });
      }
    }
  }

  // --- Social links must map to a renderable glyph ---
  const iconDep = manifest.dependencies.find((d) => d.icons);
  if (iconDep?.icons) {
    content.social.forEach((link, i) => {
      if (!iconDep.icons!.includes(link.platform)) {
        issues.push({
          path: `social[${i}].platform`, severity: "warning",
          message: `No icon for "${link.platform}" in ${iconDep.packageId}; add it to the template's declared icon set.`,
        });
      }
    });
  }

  return issues;
}