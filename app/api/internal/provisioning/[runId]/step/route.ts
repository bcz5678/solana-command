// ============================================================================
// app/api/internal/provisioning/[runId]/step/route.ts
//
// POST /api/internal/provisioning/:runId/step
//
// n8n's only write path into provisioning state. One step result per call.
//
//   { runToken, step, status, detail?, durationMs? }
//
// See CALLBACK_REFERENCE.md for the accepted message per step.
// ============================================================================

import { NextRequest, NextResponse } from "next/server";
import { requireInternalAuth, adminClient } from "@/lib/internal/guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ runId: string }> };

/**
 * Steps n8n owns.
 *
 * domain_search and domain_check_account are absent deliberately — the app
 * performs those and records them through public.record_provisioning_app_step
 * with the user's own session. A compromised n8n therefore cannot forge the
 * record of why a domain was chosen.
 */
const N8N_STEPS = new Set([
  "domain_purchase",
  "s3_folder",
  "cert_request",
  "cert_validation_records",
  "dns_host_records",
  "cert_validation_wait",
  "distribution_configure",
  "distribution_deploy",
  "ready",
]);

const STATUSES = new Set(["started", "succeeded", "failed", "skipped", "blocked"]);

/**
 * Which statuses are meaningful per step.
 *
 * The main thing this catches is a copy-pasted node that kept the previous
 * step's name — which would otherwise record a plausible-looking event against
 * the wrong step and make the plan skip something that never ran.
 */
const STEP_STATUSES: Record<string, Set<string>> = {
  domain_purchase:         new Set(["started", "succeeded", "failed", "skipped", "blocked"]),
  s3_folder:               new Set(["succeeded", "failed"]),
  cert_request:            new Set(["started", "succeeded", "failed"]),
  cert_validation_records: new Set(["succeeded", "failed"]),
  dns_host_records:        new Set(["succeeded", "failed"]),
  cert_validation_wait:    new Set(["started", "succeeded", "failed"]),
  distribution_configure:  new Set(["started", "succeeded", "failed"]),
  distribution_deploy:     new Set(["started", "succeeded", "failed", "skipped"]),
  ready:                   new Set(["succeeded", "failed"]),
};

/**
 * Every callback, unconditionally, before any validation — accepted or
 * rejected. This is the only record of a step n8n sent that never made it
 * into provisioning_events, which is exactly the case a "missing step"
 * report needs: the DB shows nothing because the row was never written, but
 * the request did arrive.
 */
function logCallback(runId: string, rawBody: string, outcome: string, extra?: unknown): void {
  console.log(`[provisioning/step] ${runId} ${outcome} — payload:`, rawBody, ...(extra !== undefined ? ["—", extra] : []));
}

export async function POST(req: NextRequest, { params }: Params) {
  const denied = requireInternalAuth(req);
  if (denied) return denied;

  const { runId } = await params;

  const rawBody = await req.text();

  let body: {
    runToken?: string;
    step?: string;
    status?: string;
    detail?: Record<string, unknown>;
    durationMs?: number;
  };

  try {
    body = JSON.parse(rawBody);
  } catch {
    logCallback(runId, rawBody, "REJECTED (invalid JSON)");
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!body.runToken) {
    logCallback(runId, rawBody, "REJECTED (missing runToken)");
    return NextResponse.json({ error: "runToken is required" }, { status: 400 });
  }

  if (!body.step || !N8N_STEPS.has(body.step)) {
    logCallback(runId, rawBody, `REJECTED (unknown step "${body.step}")`);
    return NextResponse.json(
      { error: `step must be one of: ${[...N8N_STEPS].join(", ")}` },
      { status: 400 },
    );
  }

  if (!body.status || !STATUSES.has(body.status)) {
    logCallback(runId, rawBody, `REJECTED (unknown status "${body.status}")`);
    return NextResponse.json(
      { error: `status must be one of: ${[...STATUSES].join(", ")}` },
      { status: 400 },
    );
  }

  if (!STEP_STATUSES[body.step]?.has(body.status)) {
    logCallback(runId, rawBody, `REJECTED (status "${body.status}" invalid for step "${body.step}")`);
    return NextResponse.json(
      {
        error: `status "${body.status}" is not valid for step "${body.step}" — ` +
          `expected one of: ${[...(STEP_STATUSES[body.step] ?? [])].join(", ")}`,
      },
      { status: 400 },
    );
  }

  const { data, error } = await adminClient().rpc(
    "orchestrator_record_provisioning_step",
    {
      p_run_id: runId,
      p_run_token: body.runToken,
      p_step: body.step,
      p_status: body.status,
      p_detail: body.detail ?? {},
      p_duration_ms: body.durationMs ?? null,
    },
  );

  if (error) {
    const message = error.message ?? "";

    // Stale token, missing run, or a run already terminal. 409 rather than 500
    // so n8n's retry policy does not hammer it — none of these improve on a
    // second attempt.
    if (
      message.includes("run token is stale") ||
      message.includes("not found") ||
      message.includes("is already")
    ) {
      logCallback(runId, rawBody, "REJECTED (409)", message);
      return NextResponse.json({ error: message, retryable: false }, { status: 409 });
    }

    logCallback(runId, rawBody, "REJECTED (500)", message);
    return NextResponse.json({ error: message, retryable: true }, { status: 500 });
  }

  logCallback(runId, rawBody, "ACCEPTED", data);
  return NextResponse.json({ ok: true, result: data }, { status: 200 });
}