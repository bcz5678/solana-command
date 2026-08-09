// ============================================================================
// lib/internal/guard.ts
//
// Shared plumbing for the /api/internal/* routes.
//
// These routes are the only path between n8n and the database. n8n holds no
// Postgres credential at all — just INTERNAL_API_SECRET, scoped to three
// endpoints. The service_role key stays here, in the Next.js environment.
// ============================================================================

import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { timingSafeEqual, createHmac } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";

// ============================================================================
// ENVIRONMENT
// ============================================================================

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    // Fail at first use rather than producing a confusing 401 or a client that
    // silently talks to the wrong instance.
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export const INTERNAL_SECRET     = () => requireEnv("INTERNAL_API_SECRET");
export const N8N_BUILD_WEBHOOK   = () => requireEnv("N8N_BUILD_WEBHOOK_URL");
export const N8N_WEBHOOK_SECRET  = () => requireEnv("N8N_WEBHOOK_SECRET");

// ============================================================================
// SUPABASE — SERVICE ROLE
// ============================================================================

let cached: SupabaseClient | null = null;

/**
 * Service-role client. Server-only — never import this into a component.
 *
 * The orchestrator_* functions are granted to service_role only (see
 * 20260803000700_public_api.sql), so this is the sole identity that can claim
 * or report builds.
 */
export function adminClient(): SupabaseClient {
  if (cached) return cached;

  cached = createClient(
    requireEnv("SUPABASE_URL"),
    requireEnv("SUPABASE_SERVICE_ROLE_KEY"),
    {
      auth: { persistSession: false, autoRefreshToken: false },
      // Internal routes are stateless; no cookie handling needed.
      global: { headers: { "X-Client-Info": "site-build-orchestrator" } },
    },
  );

  return cached;
}

// ============================================================================
// AUTH
// ============================================================================

/**
 * Constant-time comparison. A plain `===` on a secret leaks length and prefix
 * information through timing, which is cheap to exploit against an endpoint
 * that can be hit repeatedly.
 */
function secretMatches(provided: string, expected: string): boolean {
  const a = Buffer.from(provided, "utf8");
  const b = Buffer.from(expected, "utf8");

  // timingSafeEqual throws on length mismatch, which would itself be a timing
  // signal. Hash both to a fixed width first.
  const ha = createHmac("sha256", "len-normalise").update(a).digest();
  const hb = createHmac("sha256", "len-normalise").update(b).digest();

  return timingSafeEqual(ha, hb);
}

/**
 * Guard for every /api/internal/* route.
 * Returns a NextResponse to short-circuit with, or null to proceed.
 */
export function requireInternalAuth(req: NextRequest): NextResponse | null {
  const header = req.headers.get("x-internal-secret");

  if (!header || !secretMatches(header, INTERNAL_SECRET())) {
    // Deliberately terse: no hint about whether the header was missing,
    // malformed, or simply wrong.
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  return null;
}

// ============================================================================
// N8N HANDOFF
// ============================================================================

/**
 * Sign the outbound webhook body so n8n can verify it originated here.
 * n8n recomputes this over the raw body and compares.
 */
export function signPayload(body: string): string {
  return createHmac("sha256", N8N_WEBHOOK_SECRET()).update(body).digest("hex");
}

export interface N8nBuildPayload {
  buildId: string;
  claimToken: string;
  siteId: string;
  s3Prefix: string;
  distributionId: string | null;
  responseHeadersPolicyId: string | null;
  /** Rendered document. Fine at one-pager sizes; see the note in dispatch. */
  html: string;
  assetManifest: unknown;
  /** Present only when it differs from sites.csp_current. */
  cspChanged: string | null;
  /** Where n8n posts progress back to. Avoids hardcoding the host in n8n. */
  callbackUrl: string;
  /** Media sub-workflow endpoint. One image per call. */
  deriveUrl: string;
}

export async function dispatchToN8n(payload: N8nBuildPayload): Promise<void> {
  const body = JSON.stringify(payload);

  const res = await fetch(N8N_BUILD_WEBHOOK(), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Signature": signPayload(body),
    },
    body,
    // n8n should ack immediately and continue asynchronously. If it takes
    // longer than this, the webhook node is misconfigured to respond at the
    // end of the workflow rather than on receipt.
    signal: AbortSignal.timeout(15_000),
  });

  if (!res.ok) {
    throw new Error(`n8n webhook rejected the handoff: ${res.status} ${await res.text()}`);
  }
}

// ============================================================================
// TYPED RPC HELPERS
// ============================================================================

export interface ClaimedBuild {
  build_id: string;
  site_id: string;
  version_id: string;
  claim_token: string;
  s3_prefix: string;
  distribution_id: string | null;
  template_id: string;
  template_version: string;
  renderer_key: string;
  definition: unknown;
}

/**
 * Claim the next queued build, or null when the queue is empty.
 *
 * The `as unknown as T[]` cast is the established pattern for set-returning
 * RPCs — Supabase's generated types don't know these return sets, so the
 * inferred type is a scalar union. Drop the cast once types are regenerated.
 */
export async function claimBuild(workerId: string): Promise<ClaimedBuild | null> {
  const supabase = adminClient();

  const { data, error } = await supabase.rpc("orchestrator_claim_build", {
    p_worker_id: workerId,
  });

  if (error) throw new Error(`claim_build failed: ${error.message}`);

  const rows = (data ?? []) as unknown as ClaimedBuild[];
  return rows[0] ?? null;
}

export type BuildStatus =
  | "claimed" | "validating" | "rendering" | "uploading"
  | "invalidating" | "live" | "failed" | "cancelled";

/**
 * Report a status transition. The claim token is mandatory: a restarted worker
 * holding a stale token is rejected rather than corrupting a build that another
 * worker has since taken over.
 */
export async function reportStatus(
  buildId: string,
  claimToken: string,
  status: BuildStatus,
  detail: Record<string, unknown> = {},
): Promise<void> {
  const supabase = adminClient();

  const { error } = await supabase.rpc("orchestrator_report_status", {
    p_build_id:    buildId,
    p_claim_token: claimToken,
    p_status:      status,
    p_detail:      detail,
  });

  if (error) throw new Error(`report_status(${status}) failed: ${error.message}`);
}

/**
 * Best-effort failure report.
 *
 * Used in catch blocks, where throwing again would mask the original error and
 * leave the build non-terminal until the reaper catches it 15 minutes later.
 * Swallows its own errors deliberately.
 */
export async function reportFailureQuietly(
  buildId: string,
  claimToken: string,
  phase: string,
  err: unknown,
  /** Merged into the failure payload — validation issues, node name, etc. */
  extra?: Record<string, unknown>,
): Promise<void> {
  try {
    await reportStatus(buildId, claimToken, "failed", {
      phase,
      message: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack?.slice(0, 4000) : undefined,
      ...extra,
    });
  } catch (reportErr) {
    // Nothing left to do — the reaper is the backstop.
    console.error("[build] could not report failure:", reportErr);
  }
}
