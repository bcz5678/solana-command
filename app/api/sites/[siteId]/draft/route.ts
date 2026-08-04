// ============================================================================
// app/api/sites/[siteId]/draft/route.ts
//
// GET  /api/sites/:siteId/draft   — load the working definition
// PUT  /api/sites/:siteId/draft   — autosave
//
// The draft is the mutable working copy the form edits. It never creates a
// version row, so autosave can be as chatty as the form needs.
//
// Uses the RLS-scoped user client, NOT service_role. Ownership is enforced in
// save_site_draft() via private.owns_site(), which reads auth.uid() from the
// caller's JWT — passing service_role here would make auth.uid() null and the
// ownership check would fail closed.
// ============================================================================

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { SiteDefinitionSchema } from "@site/schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ siteId: string }> };

// ============================================================================
// GET — load draft
// ============================================================================

export async function GET(_req: NextRequest, { params }: Params) {
  const { siteId } = await params;
  const supabase = await createClient();

  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // RLS on private.sites restricts this to owner-or-super-admin, so a
  // not-found result covers both "no such site" and "not yours" without
  // leaking which.
  const { data, error } = await supabase
    .from("sites")
    .select(`
      id, name, domain, provisioning_status,
      draft_definition, draft_template_id, draft_updated_at,
      published_version_id, published_at
    `)
    .eq("id", siteId)
    .single();

  if (error || !data) {
    return NextResponse.json({ error: "Site not found" }, { status: 404 });
  }

  return NextResponse.json({ site: data }, { status: 200 });
}

// ============================================================================
// PUT — autosave
// ============================================================================

export async function PUT(req: NextRequest, { params }: Params) {
  const { siteId } = await params;
  const supabase = await createClient();

  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { definition?: unknown; templateId?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!body.definition) {
    return NextResponse.json({ error: "definition is required" }, { status: 400 });
  }

  // Parse leniently on autosave.
  //
  // A strict parse would reject a half-filled form and lose the author's work
  // on every keystroke before the required fields exist. Structural validity
  // (is this even a definition?) is checked; content completeness is not —
  // that's publish's job, via validateAgainstManifest.
  const shapeCheck = SiteDefinitionSchema.partial().safeParse(body.definition);
  if (!shapeCheck.success) {
    return NextResponse.json(
      { error: "Malformed definition", issues: shapeCheck.error.issues },
      { status: 400 },
    );
  }

  const { data, error } = await supabase.rpc("save_site_draft", {
    p_site_id: siteId,
    p_definition: body.definition,
    p_template_id: body.templateId ?? null,
  });

  if (error) {
    // The wrapper raises this when owns_site() returns false.
    if (error.message.includes("not owned by caller")) {
      return NextResponse.json({ error: "Site not found" }, { status: 404 });
    }
    console.error("[draft] save failed:", error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Returns the server timestamp so the form can show "Saved at ..." without
  // trusting the client clock.
  return NextResponse.json({ savedAt: data }, { status: 200 });
}