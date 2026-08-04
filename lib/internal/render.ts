// ============================================================================
// lib/internal/render.ts
//
// Pure render path: SiteDefinition in, { html, assetManifest } out.
//
// Lives in lib/ rather than in the route because Next.js route files may only
// export HTTP verb handlers and a fixed set of config values. Exporting
// renderDefinition from route.ts fails the build with
// "not a valid Route export field".
//
// Three consumers, all the same code path — which is what makes the form's
// live preview structurally incapable of drifting from production output:
//   1. POST /api/internal/builds/dispatch   (strict, the real build)
//   2. POST /api/sites/:id/preview          (lenient, half-finished drafts)
//   3. POST /api/internal/render            (debugging / dry run)
// ============================================================================

import { adminClient } from "@/lib/internal/guard";
import {
  SiteDefinitionSchema,
  TemplateManifestSchema,
  validateAgainstManifest,
  type ValidationIssue,
  type TemplateManifest,
} from "@site/schema";
import {
  renderTemplate,
  resolveDependency,
  buildCsp,
  type VendorPackage,
  type ResolvedDependency,
  type AssetManifest,
} from "@site/renderer";

export interface RenderResult {
  html: string;
  assetManifest: AssetManifest;
  validationIssues: ValidationIssue[];
  csp: string;
}

export interface RenderOptions {
  /**
   * false → render despite validation errors, so the preview shows something
   * while the author is still filling fields. The build path always uses true.
   */
  strict?: boolean;
  rendererKey?: string;
   /**
   * S3 prefix for the site, e.g. "uuid/".
   *
   * REQUIRED in build mode — renderTemplate throws without it. Its presence is
   * also what selects the mode: omit it and media stays as signed staging URLs
   * for preview; supply it and media is rewritten to published S3 paths.
   */
  s3Prefix?: string;
}

// ============================================================================
// VENDOR REGISTRY ADAPTER
// ============================================================================

/**
 * Shape returned by public.get_vendor_bundle(). One row per package version.
 */
interface VendorBundleRow {
  package_id: string;
  version: string;
  kind: string;
  files: unknown;
  glyphs: Record<string, { viewBox: string; path: string }> | null;
  faces: unknown;
  advisories: Array<{ id: string; severity: string; url: string }>;
  license: {
    spdx: string;
    requiresAttribution: boolean;
    attributionText?: string;
    noticeUrl?: string;
  };
}

/**
 * Collapse the flat rows from get_vendor_bundle() into the Map<packageId,
 * VendorPackage> that resolveDependency() expects.
 *
 * The RPC returns one row per (package, version) pair; VendorPackage nests
 * versions under a single package entry, so this groups them.
 */
function buildVendorRegistry(rows: VendorBundleRow[]): Map<string, VendorPackage> {
  const registry = new Map<string, VendorPackage>();

  for (const row of rows) {
    let pkg = registry.get(row.package_id);

    if (!pkg) {
      pkg = {
        id: row.package_id,
        displayName: row.package_id,
        kind: row.kind as VendorPackage["kind"],
        versions: [],
        license: row.license,
        // The DB column is authoritative for what a template MAY request;
        // resolveDependency() re-checks the requested strategy against it.
        allowedStrategies: ["inline", "copy", "shared", "external"],
      };
      registry.set(row.package_id, pkg);
    }

    pkg.versions.push({
      version: row.version,
      files: (row.files ?? []) as VendorPackage["versions"][number]["files"],
      glyphs: row.glyphs ?? undefined,
      faces: (row.faces ?? undefined) as VendorPackage["versions"][number]["faces"],
      advisories: row.advisories as VendorPackage["versions"][number]["advisories"],
      addedAt: new Date().toISOString(),
    });
  }

  return registry;
}

/**
 * Scan rendered markup for icon references.
 *
 * Preferred over the manifest's declared `icons` list because authors reliably
 * forget to prune it — a template that dropped its Discord link still declares
 * the glyph, and we'd inline dead bytes into every generated site.
 */
function detectIcons(html: string): string[] {
  const found = new Set<string>();

  // Matches <use href="#i-telegram"> emitted by the inline sprite convention.
  for (const match of html.matchAll(/href="#i-([a-z0-9-]+)"/gi)) {
    found.add(match[1].toLowerCase());
  }

  return [...found];
}

// ============================================================================
// RENDER
// ============================================================================

export async function renderDefinition(
  rawDefinition: unknown,
  opts: RenderOptions = {},
): Promise<RenderResult> {
  const supabase = adminClient();

  // ---- 1. Parse ----
  // Zod is authoritative. A definition failing here is malformed regardless of
  // what the form believed it was sending.
  const definition = SiteDefinitionSchema.parse(rawDefinition);

  // ---- 2. Load the PINNED manifest ----
  // Pinned, not latest. A rebuild two years from now must reproduce the output
  // of the template version this site was published against.
  const { data: manifestRow, error: manifestErr } = await supabase.rpc(
    "get_template_manifest",
    {
      p_template_id: definition.templateId,
      p_version: definition.templateVersion,
    },
  );

  if (manifestErr) throw new Error(`manifest lookup failed: ${manifestErr.message}`);
  if (!manifestRow) {
    throw new Error(
      `no manifest for ${definition.templateId}@${definition.templateVersion}`,
    );
  }

  const manifest: TemplateManifest = TemplateManifestSchema.parse(manifestRow);

  // ---- 3. Validate against the manifest ----
  const issues = validateAgainstManifest(definition.content, manifest);
  const errors = issues.filter((i) => i.severity === "error");

  if (errors.length > 0 && opts.strict !== false) {
    const err = new Error(
      `Content failed manifest validation (${errors.length} error${errors.length === 1 ? "" : "s"})`,
    );
    (err as Error & { issues?: ValidationIssue[] }).issues = issues;
    throw err;
  }

  // ---- 4. First render pass ----
  // Produces the markup so icons can be detected before the vendor set is
  // resolved. renderTemplate is cheap and pure; running it twice costs less
  // than shipping glyphs nothing references.
  const firstPass = await renderTemplate({
    definition,
    manifest,
    vendor: [],
    rendererKey: opts.rendererKey ?? manifest.rendererKey,
    mode: opts.s3Prefix ? "build" : "preview",
    s3Prefix: opts.s3Prefix,
  });

  const detectedIcons = detectIcons(firstPass.body);

  // ---- 5. Resolve vendor dependencies ----
  const packageIds = manifest.dependencies.map((d) => d.packageId);

  let resolved: ResolvedDependency[] = [];

  if (packageIds.length > 0) {
    const { data: vendorRows, error: vendorErr } = await supabase.rpc(
      "get_vendor_bundle",
      { p_package_ids: packageIds },
    );

    if (vendorErr) throw new Error(`vendor lookup failed: ${vendorErr.message}`);

    // Set-returning RPC — Supabase's generated types don't know these return
    // sets, so the cast stands until types are regenerated.
    const registry = buildVendorRegistry(
      (vendorRows ?? []) as unknown as VendorBundleRow[],
    );

    // Fails closed on unknown package, disallowed strategy, or open advisory.
    // A template author cannot widen a customer site's CSP by accident.
    resolved = manifest.dependencies.map((dep) =>
      resolveDependency(dep, {
        siteId: opts.s3Prefix ?? "", 
        registry,
        detectedIcons,
        advisoryThreshold: "high",
      }),
    );
  }

  // ---- 6. Final assembly ----
  // assembleDocument() inside renderTemplate owns doctype, the meta/OG block,
  // the @layer declaration, token emission, vendor markup and script hashing.
  // Authors supply only head/body/css fragments.
  const final = await renderTemplate({
    definition,
    manifest,
    vendor: resolved,
    rendererKey: opts.rendererKey ?? manifest.rendererKey,
    mode: opts.s3Prefix ? "build" : "preview",
    s3Prefix: opts.s3Prefix,
  });

  const csp = buildCsp(resolved, final.inlineScriptHashes);

  // ---- 7. Attributions ----
  // CC BY obligations, surfaced so the footer can discharge them.
  const attributions = resolved
    .map((r) => r.attribution)
    .filter((a): a is string => Boolean(a));

  return {
    html: final.html,
    assetManifest: {
      ...final.assetManifest,
      csp,
      attributions,
    },
    validationIssues: issues,
    csp,
  };
}