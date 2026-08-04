// ============================================================================
// app/api/templates/[templateId]/route.ts
//
// GET /api/templates/:templateId          — latest publishable version
// GET /api/templates/:templateId?version=1.0.0  — a specific version
//
// The version parameter is what makes editing an ALREADY-PUBLISHED site work.
// A site pinned to hero-onepager@1.0.0 must load the 1.0.0 manifest, not the
// latest — otherwise the form renders fields for capabilities the site's pinned
// renderer does not have, and publish fails validation against a manifest the
// author never saw.
// ============================================================================

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { TemplateManifestSchema } from "@site/schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ templateId: string }> };

export async function GET(req: NextRequest, { params }: Params) {
  const { templateId } = await params;
  const supabase = await createClient();

  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // null → get_template_manifest returns the latest publishable version.
  // A pinned version is returned even when is_publishable is false, so an
  // existing site stays editable after its template version is withdrawn.
  const version = new URL(req.url).searchParams.get("version");

  const { data, error } = await supabase.rpc("get_template_manifest", {
    p_template_id: templateId,
    p_version: version,
  });

  if (error) {
    console.error(`[templates] manifest lookup failed for ${templateId}:`, error.message);
    return NextResponse.json({ error: "Could not load template" }, { status: 500 });
  }

  if (!data) {
    return NextResponse.json(
      {
        error: version
          ? `Template ${templateId}@${version} not found`
          : `Template ${templateId} has no publishable version`,
      },
      { status: 404 },
    );
  }

  const parsed = TemplateManifestSchema.safeParse(data);

  if (!parsed.success) {
    // A stored manifest that no longer satisfies the schema means the schema
    // moved and this row was not re-synced. Fail loudly: rendering a form from
    // a half-valid manifest produces content the build then rejects.
    console.error(
      `[templates] manifest ${templateId}@${version ?? "latest"} failed validation:`,
      parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "),
    );

    return NextResponse.json(
      {
        error: "Stored manifest failed validation",
        issues: parsed.error.issues.map((i) => ({
          path: i.path.join("."),
          message: i.message,
        })),
      },
      { status: 500 },
    );
  }

  return NextResponse.json(
    { manifest: parsed.data },
    { status: 200, headers: { "Cache-Control": "no-store" } },
  );
}