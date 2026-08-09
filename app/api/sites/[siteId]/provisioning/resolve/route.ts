// ============================================================================
// app/api/sites/[siteId]/provisioning/resolve/route.ts
//
// POST /api/sites/:siteId/provisioning/resolve
//
// The human answer to a blocked step.
//
// Almost always domain_purchase: a run died between the Namecheap call and its
// result, so the plan cannot know whether the domain was bought. Retrying might
// buy it twice; skipping might leave it unregistered. Only a person looking at
// the Namecheap account can say which.
//
// This is the ONLY way past such a block. There is deliberately no automated
// path, and that is why this route exists rather than leaving resolution to
// psql — it needs a UI a non-DBA can use at the moment it happens.
// ============================================================================

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ siteId: string }> };

interface ResolveBody {
  runId: string;
  /**
   * confirm — verified it DID complete. Records 'succeeded'; the plan skips it.
   * retry   — verified it did NOT. Records 'failed'; the plan re-runs it.
   * abandon — cancel the run entirely.
   */
  resolution: "confirm" | "retry" | "abandon";
  /** Free text. Worth requiring in the UI for confirm — "order #12345 in the
   *  Namecheap dashboard" is what makes this auditable six weeks later. */
  note?: string;
  /** Merged into the recorded event, e.g. { orderId, chargedAmount }. */
  detail?: Record<string, unknown>;
}

export async function POST(req: NextRequest, { params }: Params) {
  const { siteId } = await params;
  const supabase = await createClient();

  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: ResolveBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!body.runId) {
    return NextResponse.json({ error: "runId is required" }, { status: 400 });
  }

  if (!["confirm", "retry", "abandon"].includes(body.resolution)) {
    return NextResponse.json(
      { error: 'resolution must be "confirm", "retry" or "abandon"' },
      { status: 400 },
    );
  }

  // The RPC checks ownership of the run's site; this is a cheap early guard so
  // a mismatched siteId in the URL fails clearly rather than as "not found".
  const { data: run } = await supabase
    .from("provisioning_runs")
    .select("id, site_id, status, blocked_step")
    .eq("id", body.runId)
    .single();

  if (!run || run.site_id !== siteId) {
    return NextResponse.json({ error: "Provisioning run not found" }, { status: 404 });
  }

  if (run.status !== "blocked") {
    return NextResponse.json(
      { error: `Run is not blocked (status: ${run.status})` },
      { status: 409 },
    );
  }

  // Confirming a purchase asserts money was spent. Requiring a note means the
  // event log carries the operator's evidence, not just their click.
  if (run.blocked_step === "domain_purchase" && body.resolution === "confirm" && !body.note) {
    return NextResponse.json(
      {
        error:
          "A note is required when confirming a domain purchase — record the " +
          "Namecheap order reference you verified.",
      },
      { status: 400 },
    );
  }

  const { data, error } = await supabase.rpc("resolve_provisioning_block", {
    p_run_id: body.runId,
    p_resolution: body.resolution,
    p_note: body.note ?? null,
    p_detail: body.detail ?? {},
  });

  if (error) {
    const message = error.message ?? "";

    if (message.includes("not found")) {
      return NextResponse.json({ error: "Provisioning run not found" }, { status: 404 });
    }
    if (message.includes("is not blocked")) {
      return NextResponse.json({ error: message }, { status: 409 });
    }

    console.error("[provisioning] resolve failed:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }

  const envelope = data as { run_id: string; status: string; resolution?: string };

  // confirm and retry re-queue the run; abandon does not.
  if (envelope.status === "queued") {
    void fetch(`${process.env.APP_URL}/api/internal/provisioning/dispatch`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Internal-Secret": process.env.INTERNAL_API_SECRET!,
      },
      body: JSON.stringify({ workerId: "resolve-trigger", max: 1 }),
      signal: AbortSignal.timeout(5_000),
    }).catch((err) => {
      console.warn("[provisioning] dispatch after resolve failed:", err);
    });
  }

  return NextResponse.json(envelope, { status: 200 });
}


// ============================================================================
// FILE: app/api/sites/[siteId]/provisioning/app-step/route.ts
//
// POST /api/sites/:siteId/provisioning/app-step
//
// Records domain_search and domain_check_account — the two steps the APP
// performs rather than n8n.
//
// Without these the wizard timeline starts at "purchasing" with no record of
// why that domain was chosen, or why purchase was skipped. They are also what
// makes provisioning_plan skip domain_purchase for an in_account domain.
//
// If your existing search and check handlers already have the results, calling
// the RPC directly from them is better than an extra round trip through here.
// This exists for the case where they do not.
// ============================================================================

/*
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ siteId: string }> };

const APP_STEPS = new Set(["domain_search", "domain_check_account"]);
const STATUSES = new Set(["succeeded", "failed", "skipped"]);

export async function POST(req: NextRequest, { params }: Params) {
  const { siteId } = await params;
  const supabase = await createClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json() as {
    runId: string;
    step: string;
    status: string;
    detail?: Record<string, unknown>;
  };

  if (!APP_STEPS.has(body.step)) {
    return NextResponse.json(
      { error: `step must be one of: ${[...APP_STEPS].join(", ")}` },
      { status: 400 },
    );
  }

  if (!STATUSES.has(body.status)) {
    return NextResponse.json(
      { error: `status must be one of: ${[...STATUSES].join(", ")}` },
      { status: 400 },
    );
  }

  const { data, error } = await supabase.rpc("record_provisioning_app_step", {
    p_run_id: body.runId,
    p_step: body.step,
    p_status: body.status,
    p_detail: body.detail ?? {},
  });

  if (error) {
    if (error.message.includes("not found")) {
      return NextResponse.json({ error: "Provisioning run not found" }, { status: 404 });
    }
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json(data, { status: 200 });
}
*/


// ============================================================================
// FILE: app/api/internal/provisioning/sweep/route.ts
//
// POST /api/internal/provisioning/sweep
//
// Cron target, every 3 minutes. Covers a run whose fire-and-forget dispatch was
// lost — Next.js restarted, n8n was unreachable at that moment, the network
// blipped. Without it such a run sits in 'queued' forever.
//
// Trivially thin: dispatch already loops and claims. This exists so the cron
// entry has a stable URL that is obviously a sweep rather than looking like a
// user action.
// ============================================================================

/*
import { NextRequest, NextResponse } from "next/server";
import { requireInternalAuth } from "@/lib/internal/guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const denied = requireInternalAuth(req);
  if (denied) return denied;

  const res = await fetch(`${process.env.APP_URL}/api/internal/provisioning/dispatch`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Internal-Secret": process.env.INTERNAL_API_SECRET!,
    },
    body: JSON.stringify({ workerId: "provisioning-sweep", max: 5 }),
  });

  return NextResponse.json(await res.json(), { status: res.status });
}
*/