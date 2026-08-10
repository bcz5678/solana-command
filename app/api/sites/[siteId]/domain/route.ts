
// ============================================================================
// FILE: app/api/sites/[siteId]/domain/route.ts
//
// POST /api/sites/:siteId/domain
//
// Records a domain the team already owns, or one selected externally. The
// counterpart to starting a purchase run.
//
// Separate from the provisioning start because the wizard may well let someone
// pick a domain in one step and choose a distribution in another — and because
// selecting a domain is reversible while starting a run is not.
// ============================================================================
 
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
 
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
 
type Params = { params: Promise<{ siteId: string }> };
 
interface SelectDomainBody {
  domain: string;
  /**
   * in_account — already in the Namecheap account (the common case, since
   *              domains have a one-year minimum and sites live weeks)
   * external   — registered elsewhere; NOTE the setup workflow writes DNS via
   *              Namecheap setHosts, which only works for domains delegated to
   *              Namecheap nameservers
   * purchase   — will be bought; normally set by start_domain_purchase instead
   */
  domainSource?: "in_account" | "external" | "purchase";
  /** Optional context for the timeline: expiry, autoRenew, who chose it. */
  detail?: Record<string, unknown>;
}
 
export async function POST(req: NextRequest, { params }: Params) {
  const { siteId } = await params;
  const supabase = await createClient();
 
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
 
  let body: SelectDomainBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
 
  if (!body.domain?.trim()) {
    return NextResponse.json({ error: "domain is required" }, { status: 400 });
  }
 
  const { data, error } = await supabase.rpc("select_domain", {
    p_site_id: siteId,
    p_domain: body.domain,
    p_domain_source: body.domainSource ?? "in_account",
    p_detail: body.detail ?? {},
  });
 
  if (error) {
    const message = error.message ?? "";
 
    if (message.includes("not owned by caller")) {
      return NextResponse.json({ error: "Site not found" }, { status: 404 });
    }
 
    // Another active site holds this domain. 409 rather than 422 — it is a
    // conflict with existing state, and the fix is releasing the other site.
    if (message.includes("is in use by site")) {
      return NextResponse.json({ error: message }, { status: 409 });
    }
 
    if (message.includes("already provisioned")) {
      return NextResponse.json({ error: message }, { status: 422 });
    }
 
    console.error("[domain] select failed:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
 
  return NextResponse.json(data, { status: 200 });
}
 
// ---- GET: which domains are claimed, for the picker ----
//
// The DB half only. Cross-reference against the live Namecheap account list in
// the wizard: anything in the account with no active claim here is available.
 
export async function GET(_req: NextRequest, { params }: Params) {
  await params; // siteId unused — claims are account-wide
  const supabase = await createClient();
 
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
 
  const { data, error } = await supabase.rpc("domain_claims");
 
  if (error) {
    console.error("[domain] claims lookup failed:", error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
 
  return NextResponse.json(
    { claims: data ?? [] },
    { status: 200, headers: { "Cache-Control": "no-store" } },
  );
}
 