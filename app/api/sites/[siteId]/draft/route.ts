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
import { DraftGuard } from "@site/schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// jsonb has no practical size limit and autosave fires constantly.
const MAX_DRAFT_BYTES = 2 * 1024 * 1024;

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

  // Cheap pre-parse rejection when the client reports its size honestly. Not a
  // substitute for the byte-accurate check below — content-length can be
  // absent (chunked transfer) or simply wrong — just avoids buffering and
  // JSON-parsing a payload we're going to reject anyway.
  const contentLength = Number(req.headers.get("content-length") ?? 0);
  if (contentLength > MAX_DRAFT_BYTES) {
    return NextResponse.json(
      { error: "Draft exceeds 2MB — images should be references, not inlined data" },
      { status: 413 },
    );
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

  // Shape guard, not a schema parse: DraftGuard checks only the top-level key
  // types (is this plausibly a definition, not a bug or abuse vector) and
  // passes everything else through untouched. SiteDefinitionSchema.partial()
  // is shallow — content would still need every nested required field the
  // moment it's present — and a deeply-partial mirror of SiteContentSchema
  // would be a second schema that drifts from the first. Content completeness
  // is publish's job, via validateAgainstManifest.
  const shapeCheck = DraftGuard.safeParse(body.definition);
  if (!shapeCheck.success) {
    return NextResponse.json(
      { error: "Malformed definition", issues: shapeCheck.error.issues },
      { status: 400 },
    );
  }

  // Byte-accurate and authoritative — content-length above is a best-effort
  // fast path, not a guarantee (a client can omit or misreport it).
  if (Buffer.byteLength(JSON.stringify(body.definition), "utf8") > MAX_DRAFT_BYTES) {
    return NextResponse.json(
      { error: "Draft exceeds 2MB — images should be references, not inlined data" },
      { status: 413 },
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