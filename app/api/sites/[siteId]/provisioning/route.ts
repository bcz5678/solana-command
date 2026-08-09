// ============================================================================
// app/api/sites/[siteId]/provisioning/route.ts
//
// GET  /api/sites/:siteId/provisioning   — the wizard's timeline
// POST /api/sites/:siteId/provisioning   — start a purchase or setup run
//
// RLS-scoped user client. The wrappers call auth.uid() via private.owns_site,
// so a service-role client here would fail closed.
// ============================================================================

import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ siteId: string }> };

// ============================================================================
// GET — timeline
// ============================================================================

export async function GET(_req: NextRequest, { params }: Params) {
  const { siteId } = await params;
  const supabase = await createClient();

  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data, error } = await supabase.rpc("get_provisioning_status", {
    p_site_id: siteId,
  });

  if (error) {
    if (error.message.includes("site not found")) {
      return NextResponse.json({ error: "Site not found" }, { status: 404 });
    }
    console.error("[provisioning] status lookup failed:", error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data, {
    status: 200,
    headers: { "Cache-Control": "no-store" },
  });
}

// ============================================================================
// POST — start a run
// ============================================================================

interface StartBody {
  kind: "purchase" | "setup";
  /** purchase only */
  domain?: string;
  /** setup only — the team's selection, fetched live from AWS in the wizard */
  distributionId?: string;
  distributionUrl?: string;
  domainSource?: "purchase" | "in_account" | "external";
}

export async function POST(req: NextRequest, { params }: Params) {
  const { siteId } = await params;
  const supabase = await createClient();

  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: StartBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (body.kind !== "purchase" && body.kind !== "setup") {
    return NextResponse.json(
      { error: 'kind must be "purchase" or "setup"' },
      { status: 400 },
    );
  }

  // Server-generated, same reasoning as publish: a client-supplied key lets a
  // buggy client collide with someone else's run — and on the purchase path
  // that collision involves money.
  const idempotencyKey = randomUUID();

  let result: unknown;
  let error: { message: string } | null = null;

  if (body.kind === "purchase") {
    if (!body.domain) {
      return NextResponse.json(
        { error: "domain is required for a purchase run" },
        { status: 400 },
      );
    }

    ({ data: result, error } = await supabase.rpc("start_domain_purchase", {
      p_site_id: siteId,
      p_domain: body.domain,
      p_idempotency_key: idempotencyKey,
    }));
  } else {
    if (!body.distributionId || !body.distributionUrl) {
      return NextResponse.json(
        { error: "distributionId and distributionUrl are required for a setup run" },
        { status: 400 },
      );
    }

    ({ data: result, error } = await supabase.rpc("start_domain_setup", {
      p_site_id: siteId,
      p_distribution_id: body.distributionId,
      p_distribution_url: body.distributionUrl,
      p_idempotency_key: idempotencyKey,
      p_domain_source: body.domainSource ?? "purchase",
    }));
  }

  if (error) {
    const message = error.message ?? "";

    if (message.includes("not owned by caller")) {
      return NextResponse.json({ error: "Site not found" }, { status: 404 });
    }

    // Preconditions the wizard should have prevented: no domain, no s3_prefix,
    // already provisioned, already purchased. 422 rather than 500 — the request
    // was well-formed but the site is not in a valid state.
    if (
      message.includes("already provisioned") ||
      message.includes("has no domain") ||
      message.includes("has no s3_prefix") ||
      message.includes("already been purchased")
    ) {
      return NextResponse.json({ error: message }, { status: 422 });
    }

    console.error("[provisioning] start failed:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }

  const envelope = result as {
    run_id: string;
    status: string;
    message?: string;
    duplicate?: boolean;
  };

  // Fire-and-forget. The wizard watches Realtime on provisioning_events, so
  // there is no reason to hold the response open through a handoff.
  //
  // If this is lost, the run sits in 'queued' and the sweep claims it — that
  // durability is why the queue exists rather than dispatching inline.
  void fetch(`${process.env.APP_URL}/api/internal/provisioning/dispatch`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Internal-Secret": process.env.INTERNAL_API_SECRET!,
    },
    body: JSON.stringify({ workerId: "provisioning-trigger", max: 1 }),
    signal: AbortSignal.timeout(5_000),
  }).catch((err) => {
    console.warn("[provisioning] dispatch trigger failed, sweep will pick it up:", err);
  });

  return NextResponse.json(envelope, { status: 202 });
}