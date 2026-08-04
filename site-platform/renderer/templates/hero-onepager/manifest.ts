// ============================================================================
// src/site-platform/renderer/templates/hero-onepager/manifest.ts
//
// The manifest as CODE, not only as a SQL seed row.
//
// I originally put this only in 20260803000900_seed.sql, which was a mistake:
// tests could not reach it, and the SQL row and the render function could drift
// with nothing to catch it. The row in private.template_versions should be
// GENERATED from this — see scripts/sync-manifests.ts at the bottom.
//
// The type annotation means a manifest that no longer satisfies the schema
// fails `tsc`, not a build three weeks later.
// ============================================================================

import { TemplateManifestSchema, type TemplateManifest } from "@site/schema";

export const heroOnepagerManifest: TemplateManifest = TemplateManifestSchema.parse({
  id: "hero-onepager",
  name: "Hero One-Pager",
  description:
    "Full-bleed vertical scroller. Fixed header, hero panel, up to eight stacked sections.",
  version: "1.1.0",
  previewImage: "/template-previews/hero-onepager.png",

  // Must match the registerTemplate() key in ../index.ts.
  rendererKey: "hero-onepager@1",

  flow: "vertical",

  // gallery and embed are deliberately absent: this template has no lightbox
  // and no iframe sandboxing, so offering them would produce broken output.
  supportedSectionTypes: ["prose", "stats", "timeline", "faq", "cards"],

  // Past ~8 full-viewport panels the page becomes a scroll marathon. The form
  // enforces this at authoring time rather than letting it ship.
  sectionCount: { min: 1, max: 8 },

  supportsModules: ["token", "countdown"],

  // Blocks publish when empty. `[]` expands to "every element of".
  requiredContent: [
    "meta.fqdn",
    "meta.title",
    "brand.name",
    "hero.title",
    "hero.backgroundImage",
    "sections[].title",
    "sections[].navLabel",
  ],

  dependencies: [
    {
      packageId: "fontawesome-brands",
      version: "6.5.2",
      strategy: "inline",
      // Optional: a site with no social links needs no icons at all, and the
      // build should not fail over a missing decorative dependency.
      required: false,
      icons: ["x-twitter", "telegram", "discord"],
      cssLayer: "vendor",
      preload: false,
      scriptLoading: "defer",
    },
    {
      packageId: "inter",
      version: "4.0",
      strategy: "copy",
      required: true,
      weights: [400, 700],
      styles: ["normal"],
      subsets: ["latin"],
      cssLayer: "vendor",
      // The body font is render-blocking in effect; preload the 400 weight.
      preload: true,
      scriptLoading: "defer",
    },
  ],

  // Drives publish-time crop generation AND the form's CSS focal-point preview,
  // so what the author sees is exactly what the build produces.
  imageAspect: {
    hero: "16/9",
    section: "16/9",
    card: "4/3",
    gallery: "1/1",
  },

  // Progressive disclosure in the design tab — no point showing a mobile-drawer
  // control for a template with no drawer.
  usesThemeKeys: [
    "core.colors.background",
    "core.colors.primary",
    "core.colors.onPrimary",
    "core.colors.text",
    "core.colors.textMuted",
    "core.colors.border",
    "core.colors.overlay",
    "core.typography.fontFamilyBase",
    "core.typography.scaleRatio",
    "core.typography.headingTransform",
    "core.spacing.contentMaxInline",
    "core.spacing.sectionPaddingBlock",
    "core.spacing.radius",
    "semantic.navBackground",
    "semantic.footerBackground",
    "semantic.footerForeground",
    "semantic.mobileMenuBackground",
  ],

  // Tier 3: template-only knobs, kept out of the shared theme surface.
customThemeSchema: {
    headerBlur: {
      type: "length",
      label: "Header backdrop blur",
      default: "8px",
    },
    sectionMinHeight: {
      type: "length",
      label: "Section height",
      default: "100vh",
    },

    // Button geometry. Template-scoped rather than core: a horizontal
    // template's CTAs sit in a different visual rhythm and want their own
    // proportions.
    btnPadY: {
      type: "length",
      label: "Button vertical padding",
      default: "14px",
    },
    btnPadX: {
      type: "length",
      label: "Button horizontal padding",
      default: "34px",
    },
    btnBorderWidth: {
      type: "length",
      label: "Button border width",
      default: "2px",
    },

    socialGap: {
      type: "length",
      label: "Social icon spacing",
      default: "24px",
    },
  },

  capabilities: {
    hasStickyNav: true,
    hasMobileDrawer: true,
    hasScrollSnap: false,
    hasProgressIndicator: false,
    supportsPerSectionBackground: true,
    supportsDarkModeToggle: false,
  },
});

// ============================================================================
// SYNC
// ============================================================================

/*
 * scripts/sync-manifests.ts — run in CI on merge to main.
 *
 * Upserts each registered template's manifest into private.template_versions,
 * so the database row is derived from code rather than hand-maintained
 * alongside it.
 *
 *   import { heroOnepagerManifest } from "@site/renderer/templates/...";
 *
 *   await supabase.rpc("admin_upsert_template_version", {
 *     p_template_id: heroOnepagerManifest.id,
 *     p_version:     heroOnepagerManifest.version,
 *     p_renderer_key: heroOnepagerManifest.rendererKey,
 *     p_manifest:    heroOnepagerManifest,
 *   });
 *
 * Note the immutability trigger on template_versions: an upsert against an
 * EXISTING (template_id, version) will raise. That is intentional — changing a
 * manifest requires bumping the version, because sites pinned to the old one
 * must keep rendering the way they were published. CI should treat that error
 * as "you forgot to bump the version", not as a failure to retry.
 */