

// ============================================================================
// FILE: app/api/sites/[siteId]/route.ts
//
// GET   /api/sites/:siteId   — one site
// PATCH /api/sites/:siteId   — edit name and token identity
//
// Deliberately narrow. domain, s3_prefix, distribution_id, cert_arn and
// provisioning_status are provisioning output — a PATCH surface for them
// produces a site whose row disagrees with what CloudFront is serving.
//
// There is no DELETE. Removing a site means teardown, which has AWS resources
// to release: POST /api/sites/:siteId/teardown.
// ============================================================================


import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ siteId: string }> };

export async function GET(_req: NextRequest, { params }: Params) {
  const { siteId } = await params;
  const supabase = await createClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // RLS restricts this to owner-or-super-admin, so a missing row covers both
  // "no such site" and "not yours" without leaking which.
  const { data, error } = await supabase
    .from("sites")
    .select(`
      id, name, token_symbol, contract_address,
      domain, domain_source, domain_released_at, s3_prefix,
      provisioning_status, distribution_id, distribution_domain, cert_arn,
      draft_template_id, draft_updated_at,
      published_version_id, published_at, is_archived,
      created_at, updated_at
    `)
    .eq("id", siteId)
    .single();

  if (error || !data) {
    return NextResponse.json({ error: "Site not found" }, { status: 404 });
  }

  return NextResponse.json(
    { site: data },
    { status: 200, headers: { "Cache-Control": "no-store" } },
  );
}

export async function PATCH(req: NextRequest, { params }: Params) {
  const { siteId } = await params;
  const supabase = await createClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json() as {
    name?: string;
    tokenSymbol?: string;
    contractAddress?: string;
  };

  const { data, error } = await supabase.rpc("update_site", {
    p_site_id: siteId,
    p_name: body.name ?? null,
    p_token_symbol: body.tokenSymbol ?? null,
    p_contract_address: body.contractAddress ?? null,
  });

  if (error) {
    if (error.message.includes("not owned by caller")) {
      return NextResponse.json({ error: "Site not found" }, { status: 404 });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // `prefix_locked` tells the wizard why editing the symbol did not rename the
  // folder: once provisioning has run, s3_prefix is baked into CloudFront's
  // origin path and changing it would point at a folder that does not exist.
  return NextResponse.json(data, { status: 200 });
}
