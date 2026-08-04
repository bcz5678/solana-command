// ============================================================================
// app/api/internal/builds/[buildId]/status/route.ts
//
// POST /api/internal/builds/:buildId/status
//
// n8n's callback. The only way the orchestrator mutates a build.
//
// n8n calls this at each phase boundary: uploading -> invalidating -> live,
// plus 'failed' from the workflow's error branch. Every call also refreshes
// heartbeat_at, so these double as the liveness signal that keeps the reaper
// from killing an in-progress build.
// ============================================================================

import { NextRequest, NextResponse } from "next/server";
import { requireInternalAuth, adminClient } from "@/lib/internal/guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Mirrors private.build_status. Only the transitions n8n owns are accepted —
// 'claimed', 'validating' and 'rendering' belong to the dispatch route, and
// accepting them here would let a confused workflow rewind a build.
const N8N_STATUSES = new Set([
  "uploading", "invalidating", "live", "failed",
]);

// Next 15+ delivers route params as a Promise.
type Params = { params: Promise<{ buildId: string }> };

export async function POST(req: NextRequest, { params }: Params) {
  const denied = requireInternalAuth(req);
  if (denied) return denied;

  const { buildId } = await params;

  let body: {
    claimToken?: string;
    status?: string;
    detail?: Record<string, unknown>;
  };

  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  // ---- Shape checks ----
  if (!body.claimToken) {
    return NextResponse.json({ error: "claimToken is required" }, { status: 400 });
  }

  if (!body.status || !N8N_STATUSES.has(body.status)) {
    return NextResponse.json(
      { error: `status must be one of: ${[...N8N_STATUSES].join(", ")}` },
      { status: 400 },
    );
  }

  // ---- Report ----
  const { data, error } = await adminClient().rpc("orchestrator_report_status", {
    p_build_id:    buildId,
    p_claim_token: body.claimToken,
    p_status:      body.status,
    p_detail:      body.detail ?? {},
  });

  if (error) {
    const message = error.message ?? "";

    // Stale claim token. Almost always means the reaper already failed this
    // build and something else picked the site up. 409 rather than 500 so n8n
    // can distinguish "you lost the race" from "the database is down" — the
    // former should not be retried.
    if (message.includes("claim token is stale") || message.includes("not found")) {
      return NextResponse.json(
        { error: "Build not found or claim token is stale", retryable: false },
        { status: 409 },
      );
    }

    // Illegal transition. Usually a duplicate callback arriving out of order
    // after the build already reached a terminal state. Also not retryable —
    // and importantly, not an error worth alerting on.
    if (message.includes("illegal build transition")) {
      return NextResponse.json(
        { error: message, retryable: false },
        { status: 409 },
      );
    }

    console.error(`[build-status] ${buildId} -> ${body.status} failed:`, error);
    return NextResponse.json(
      { error: message, retryable: true },
      { status: 500 },
    );
  }

  // ---- Post-terminal bookkeeping ----
  // report_build_status() already advanced sites.published_version_id and
  // csp_current inside its own transaction, so there is nothing to do here
  // that could leave the two out of sync. This is purely observability.
  if (body.status === "live") {
    console.info(`[build-status] ${buildId} published`);
  } else if (body.status === "failed") {
    console.warn(`[build-status] ${buildId} failed:`, body.detail);
  }

  return NextResponse.json({ ok: true, build: data }, { status: 200 });
}
