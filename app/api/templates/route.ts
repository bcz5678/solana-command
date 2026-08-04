// ============================================================================
// app/api/templates/route.ts
//
// GET /api/templates?includeInactive=false
//
// Replaces the old /api/site-templates, which read public.site_templates
// directly. That table was a plain public table with a permissive read policy;
// the catalog now lives in private.templates + private.template_versions and is
// only reachable through the SECURITY DEFINER wrapper.
//
// Uses the RLS-scoped USER client, not service_role. public.list_templates is
// granted to `authenticated` only, so an anon caller gets a permission error
// rather than the catalog.
// ============================================================================

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { TemplateManifestSchema, type TemplateManifest } from "@site/schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Row shape from public.list_templates(). One row per template — the LATEST
 * publishable version of each, not every version.
 */
interface TemplateRow {
  template_id: string;
  name: string;
  description: string;
  preview_image: string | null;
  version: string;
  manifest: unknown;
  renderer_key: string;
}

export interface TemplateListEntry {
  id: string;
  name: string;
  description: string;
  previewImage: string | null;
  version: string;
  rendererKey: string;
  /** "tokenized" | "slotted" — drives whether the form shows a Design tab. */
  kind: TemplateManifest["kind"];
  manifest: TemplateManifest;
}

// ============================================================================
// CATALOG CACHE
//
// The catalog is identical for every authenticated caller — list_templates
// takes no user input and applies no per-user filtering. The form hits this on
// every load, so a short module-scoped TTL removes a round trip per page view.
//
// 60s means a freshly synced template appears within a minute. Bypass with
// ?fresh=1 when verifying a sync.
// ============================================================================

let cache: { at: number; entries: TemplateListEntry[] } | null = null;
const TTL_MS = 60_000;

export async function GET(req: NextRequest) {
  const supabase = await createClient();

  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const includeInactive = url.searchParams.get("includeInactive") === "true";
  const fresh = url.searchParams.get("fresh") === "1";

  // Only the default view is cached. includeInactive is an admin path and rare
  // enough that caching it would mostly serve stale results to the one person
  // who cares about freshness.
  if (!includeInactive && !fresh && cache && Date.now() - cache.at < TTL_MS) {
    return NextResponse.json(
      { templates: cache.entries, cached: true },
      { status: 200, headers: { "Cache-Control": "no-store" } },
    );
  }

  const { data, error } = await supabase.rpc("list_templates", {
    p_active_only: !includeInactive,
  });

  if (error) {
    console.error("[templates] list failed:", error.message);
    return NextResponse.json({ error: "Could not load templates" }, { status: 500 });
  }

  // Set-returning RPC. The generated types infer a scalar union, so the cast
  // stands until types are regenerated — the established pattern here.
  const rows = (data ?? []) as unknown as TemplateRow[];

  const entries: TemplateListEntry[] = [];
  const malformed: string[] = [];

  for (const row of rows) {
    // Parse every manifest through Zod rather than trusting the column.
    // A row hand-edited in the SQL editor, or written by an older sync script,
    // would otherwise reach the form and break field generation in a way that
    // looks like a form bug.
    const parsed = TemplateManifestSchema.safeParse(row.manifest);

    if (!parsed.success) {
      malformed.push(`${row.template_id}@${row.version}`);
      console.error(
        `[templates] manifest for ${row.template_id}@${row.version} failed validation:`,
        parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "),
      );
      continue;   // omit rather than ship something the form cannot render
    }

    entries.push({
      id: row.template_id,
      name: row.name,
      description: row.description,
      previewImage: row.preview_image,
      version: row.version,
      rendererKey: row.renderer_key,
      kind: parsed.data.kind,
      manifest: parsed.data,
    });
  }

  if (!includeInactive) {
    cache = { at: Date.now(), entries };
  }

  return NextResponse.json(
    {
      templates: entries,
      // Surfaced so a broken sync is visible in the UI rather than presenting
      // as "my template disappeared".
      ...(malformed.length > 0 ? { malformed } : {}),
    },
    { status: 200, headers: { "Cache-Control": "no-store" } },
  );
}

/** Called by sync-manifests after a successful write, so the form sees it immediately. */
export function invalidateTemplateCache(): void {
  cache = null;
}