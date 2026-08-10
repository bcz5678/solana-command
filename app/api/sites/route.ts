// ============================================================================
// app/api/sites/route.ts
//
// GET  /api/sites   — list sites for the picker
// POST /api/sites   — create a site
//
// NOTE: an older app/api/sites/route.ts existed against the retired
// public.site_templates model and was deleted. This is a new file with a
// different purpose — do not resurrect the old one.
//
// Sites are created here and nowhere else. select_domain,
// start_domain_purchase and start_domain_setup all require an existing
// siteId, which is why this was the blocking gap.
// ============================================================================

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ============================================================================
// GET — the "Edit Existing Site" picker
// ============================================================================

export async function GET(req: NextRequest) {
  const supabase = await createClient();

  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const includeArchived =
    new URL(req.url).searchParams.get("includeArchived") === "true";

  const { data, error } = await supabase.rpc("list_sites", {
    p_include_archived: includeArchived,
  });

  if (error) {
    console.error("[sites] list failed:", error.message);
    return NextResponse.json({ error: "Could not load sites" }, { status: 500 });
  }

  // Set-returning RPC — the cast stands until generated types are regenerated.
  return NextResponse.json(
    { sites: (data ?? []) as unknown as unknown[] },
    { status: 200, headers: { "Cache-Control": "no-store" } },
  );
}

// ============================================================================
// POST — create
// ============================================================================

interface CreateSiteBody {
  name: string;
  tokenSymbol: string;
  /** Full base58 mint address. The first 7 chars form the s3_prefix. */
  contractAddress: string;
  /** Optional: seeds sites.draft_template_id for the builder. */
  templateId?: string;
}

export async function POST(req: NextRequest) {
  const supabase = await createClient();

  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: CreateSiteBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!body.name?.trim()) {
    return NextResponse.json({ error: "name is required" }, { status: 400 });
  }
  if (!body.tokenSymbol?.trim()) {
    return NextResponse.json({ error: "tokenSymbol is required" }, { status: 400 });
  }
  if (!body.contractAddress?.trim()) {
    return NextResponse.json({ error: "contractAddress is required" }, { status: 400 });
  }

  const { data, error } = await supabase.rpc("create_site", {
    p_name: body.name,
    p_token_symbol: body.tokenSymbol,
    p_contract_address: body.contractAddress,
    p_template_id: body.templateId ?? null,
  });

  if (error) {
    const message = error.message ?? "";

    // Malformed inputs the wizard should have caught: an emoji-only symbol, a
    // truncated or non-base58 address.
    if (
      message.includes("no usable characters") ||
      message.includes("not valid base58") ||
      message.includes("is required")
    ) {
      return NextResponse.json({ error: message }, { status: 422 });
    }

    // Twelve characters of address fragment collided — effectively impossible
    // unless someone is archiving-and-recreating the same token repeatedly.
    if (message.includes("could not derive a unique s3_prefix")) {
      return NextResponse.json({ error: message }, { status: 409 });
    }

    console.error("[sites] create failed:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }

  return NextResponse.json(data, { status: 201 });
}
