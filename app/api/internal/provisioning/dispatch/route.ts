// ============================================================================
// app/api/internal/provisioning/dispatch/route.ts
//
// POST /api/internal/provisioning/dispatch
//
// Claims a queued provisioning run and hands it to the matching n8n workflow.
// Two kinds, two webhooks:
//
//   purchase → Token - Domain Purchase
//   setup    → Token - Domain Setup
//
// Callers: POST /api/sites/:siteId/provisioning (fire-and-forget after
// starting a run), and the cron sweep as a safety net.
//
// n8n holds no database credential. Everything it needs — the domain, the
// team's distribution selection, the resolved plan — arrives in this payload.
// ============================================================================

import { NextRequest, NextResponse } from "next/server";
import { requireInternalAuth, adminClient, signPayload, N8N_WEBHOOK_SECRET } from "@/lib/internal/guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

interface PlanEntry {
  step: string;
  action: "run" | "skip" | "block";
  reason: string;
}

interface ClaimedRun {
  run_id: string;
  site_id: string;
  run_kind: "purchase" | "setup";
  run_token: string;
  domain: string;
  domain_source: "purchase" | "in_account" | "external";
  site_name: string;
  s3_prefix: string | null;
  distribution_id: string | null;
  distribution_url: string | null;
  origin_path: string | null;
  plan: PlanEntry[];
}

function webhookFor(kind: ClaimedRun["run_kind"]): string {
  const url =
    kind === "purchase"
      ? process.env.N8N_DOMAIN_PURCHASE_WEBHOOK_URL
      : process.env.N8N_DOMAIN_SETUP_WEBHOOK_URL;

  if (!url) {
    throw new Error(
      `No webhook configured for ${kind} runs — set ` +
        (kind === "purchase"
          ? "N8N_DOMAIN_PURCHASE_WEBHOOK_URL"
          : "N8N_DOMAIN_SETUP_WEBHOOK_URL"),
    );
  }
  return url;
}

/** First step of each kind, used when a handoff fails before any step ran. */
const FIRST_STEP: Record<ClaimedRun["run_kind"], string> = {
  purchase: "domain_purchase",
  setup: "s3_folder",
};

export async function POST(req: NextRequest) {
  const denied = requireInternalAuth(req);
  if (denied) return denied;

  let body: { workerId?: string; max?: number } = {};
  try {
    body = await req.json();
  } catch {
    // Empty body is fine — the sweep calls this with nothing.
  }

  const workerId = body.workerId ?? `next-${process.env.HOSTNAME ?? "local"}`;
  const max = Math.min(Math.max(body.max ?? 1, 1), 5);
  const supabase = adminClient();

  const dispatched: string[] = [];
  const blocked: Array<{ runId: string; step: string }> = [];

  for (let i = 0; i < max; i++) {
    const { data, error } = await supabase.rpc("orchestrator_claim_provisioning", {
      p_worker_id: workerId,
    });

    if (error) {
      console.error("[provisioning/dispatch] claim failed:", error.message);
      return NextResponse.json(
        { error: error.message, dispatched: dispatched.length },
        { status: 500 },
      );
    }

    // Set-returning RPC — the cast stands until generated types are regenerated.
    const run = ((data ?? []) as unknown as ClaimedRun[])[0];
    if (!run) break; // queue empty

    // ---- Preflight the plan ----
    //
    // A plan containing a 'block' has nothing to hand over: a previous attempt
    // left something needing human confirmation. Report it and move on, rather
    // than starting a workflow that would immediately halt.
    const blocker = run.plan?.find((p) => p.action === "block");

    if (blocker) {
      await supabase.rpc("orchestrator_record_provisioning_step", {
        p_run_id: run.run_id,
        p_run_token: run.run_token,
        p_step: blocker.step,
        p_status: "blocked",
        p_detail: { reason: blocker.reason, source: "dispatch-preflight" },
      });

      blocked.push({ runId: run.run_id, step: blocker.step });
      continue;
    }

    // Every step already done — close the run out rather than dispatching a
    // no-op workflow.
    if (!run.plan?.some((p) => p.action === "run")) {
      await supabase.rpc("orchestrator_record_provisioning_step", {
        p_run_id: run.run_id,
        p_run_token: run.run_token,
        p_step: "ready",
        p_status: "succeeded",
        p_detail: { reason: "all steps already complete" },
      });
      dispatched.push(run.run_id);
      continue;
    }

    // ---- Payload ----
    //
    // Field names match the workflow's `Set Token Config` node so its existing
    // `$json.origin_path ?? "..."` fallbacks resolve to real values instead of
    // the hardcoded defaults.
    const payload = {
      // Callback identity. Provisioning uses runToken; builds use claimToken —
      // deliberately different names so a copy-pasted node fails loudly.
      runId: run.run_id,
      runToken: run.run_token,
      callbackUrl: `${process.env.APP_URL}/api/internal/provisioning/${run.run_id}/step`,

      // Set Token Config inputs
      origin_path: run.origin_path, // "/PEPE_7xKXtg2" — CloudFront form
      domain_name: run.domain,
      distribution_id: run.distribution_id,
      distribution_url: run.distribution_url,

      // Context
      siteId: run.site_id,
      siteName: run.site_name,
      s3Prefix: run.s3_prefix, // "PEPE_7xKXtg2/" — S3 key form
      domainSource: run.domain_source,

      // Resolved server-side and handed over whole, so n8n branches on data
      // rather than reimplementing the resume rules.
      plan: run.plan,
    };

    const serialised = JSON.stringify(payload);

    try {
      const res = await fetch(webhookFor(run.run_kind), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          // Verified inside the workflow, per PROVISIONING_ARCHITECTURE.md's
          // "verify HMAC" step.
          "X-Signature": signPayload(serialised),
          // The webhook trigger node's own Header Auth credential — separate
          // check, same secret, raw rather than HMAC'd.
          "X-N8N_WEBHOOK_SECRET": N8N_WEBHOOK_SECRET(),
        },
        body: serialised,
        // The workflow responds at the END (Respond to Webhook), not on
        // receipt, and setup includes an ACM validation loop. The response is
        // ignored — progress arrives via callbacks.
        signal: AbortSignal.timeout(120_000),
      });

      if (!res.ok) {
        throw new Error(`n8n rejected the handoff: ${res.status} ${await res.text()}`);
      }

      dispatched.push(run.run_id);
    } catch (err) {
      console.error(`[provisioning/dispatch] handoff failed for ${run.run_id} (${run.run_kind}):`, err);

      // Fail the run rather than leaving it 'claimed' — the reaper would sit on
      // it for an hour, which is a long time to stare at a stalled wizard.
      // Best-effort — a query builder is a thenable, not a real Promise, so
      // .catch() isn't a method on it directly; wrap it in one that is.
      await Promise.resolve(
        supabase.rpc("orchestrator_record_provisioning_step", {
          p_run_id: run.run_id,
          p_run_token: run.run_token,
          p_step: FIRST_STEP[run.run_kind],
          p_status: "failed",
          p_detail: {
            phase: "handoff",
            kind: run.run_kind,
            message: err instanceof Error ? err.message : String(err),
          },
        }),
      ).catch(() => {});

      return NextResponse.json(
        {
          error: "Could not hand off to the provisioning workflow",
          dispatched: dispatched.length,
        },
        { status: 502 },
      );
    }
  }

  return NextResponse.json(
    { dispatched: dispatched.length, runIds: dispatched, blocked },
    { status: 200 },
  );
}