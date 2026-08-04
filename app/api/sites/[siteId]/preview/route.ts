// ============================================================================
// app/api/sites/[siteId]/preview/route.ts
//
// POST /api/sites/:siteId/preview
//
// Lenient dry-run render. Returns the document plus the current validation
// issues, touching no build record and no S3.
//
// Two uses:
//   1. The form's live preview iframe (srcDoc), debounced on edit
//   2. "Check before publish" — see the blockers without queuing anything
//
// This calls the SAME renderDefinition() the build path calls. That is the
// whole reason the renderer is a pure function: preview and production cannot
// structurally diverge.
// ============================================================================

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { renderDefinition } from "@/lib/internal/render";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

type Params = { params: Promise<{ siteId: string }> };

export async function POST(req: NextRequest, { params }: Params) {
  const { siteId } = await params;
  const supabase = await createClient();

  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // ---- Ownership ----
  //
  // This matters more than it looks. renderDefinition() uses the SERVICE-ROLE
  // client internally (it needs the manifest and vendor registry, which are
  // wrapper-gated). So the ownership check must happen HERE, against the
  // user's RLS-scoped session, before that privileged path is entered.
  //
  // Without it, any authenticated user could render arbitrary definitions
  // against any template — not catastrophic, but it is an unbounded compute
  // endpoint behind a login.
  const { data: site } = await supabase
    .from("sites")
    .select("id, draft_definition")
    .eq("id", siteId)
    .single();

  if (!site) {
    return NextResponse.json({ error: "Site not found" }, { status: 404 });
  }

  let body: { definition?: unknown } = {};
  try {
    body = await req.json();
  } catch {
    // Empty body is valid — falls back to the stored draft below.
  }

  // Prefer the posted definition (the form's unsaved in-memory state) so the
  // preview reflects the current keystroke, not the last autosave.
  const definition = body.definition ?? site.draft_definition;

  if (!definition || Object.keys(definition as object).length === 0) {
    return NextResponse.json(
      { error: "No definition to preview" },
      { status: 400 },
    );
  }

  try {
    const result = await renderDefinition(definition, {
      // Lenient: render a half-finished draft so the author sees progress.
      // Errors come back in validationIssues instead of throwing.
      strict: false,
    });

    return NextResponse.json(
      {
        html: result.html,
        issues: result.validationIssues,
        // Surfaced so the form can show what the build would upload —
        // useful for spotting an unexpectedly heavy vendor set.
        assetCount:
          (result.assetManifest.copies?.length ?? 0) +
          (result.assetManifest.media?.length ?? 0),
      },
      {
        status: 200,
        // Previews are per-keystroke and per-user. Never cache them.
        headers: { "Cache-Control": "no-store" },
      },
    );
  } catch (err) {
    // With strict:false, a throw means the definition is structurally broken
    // (Zod parse failure) or the pinned template version no longer resolves —
    // not merely incomplete content.
    const issues = (err as Error & { issues?: unknown }).issues;

    if (issues) {
      return NextResponse.json(
        { error: "Definition failed validation", issues },
        { status: 422 },
      );
    }

    console.error("[preview] render failed:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Preview failed" },
      { status: 500 },
    );
  }
}