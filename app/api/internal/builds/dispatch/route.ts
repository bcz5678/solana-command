// ============================================================================
// app/api/internal/builds/dispatch/route.ts
//
// POST /api/internal/builds/dispatch
//
// The workhorse. Claims a queued build, validates and renders it, then hands
// the artifacts to n8n for the S3 and CloudFront work.
//
// Two callers, same code path:
//   1. /api/sites/:id/publish — fire-and-forget immediately after queuing, so
//      the common case has no polling latency.
//   2. A cron sweep every few minutes — covers a missed webhook, a Next.js
//      restart mid-dispatch, or n8n being down at publish time.
//
// The queue is the durability layer. Losing a dispatch call is survivable
// because the build row persists in 'queued' until something claims it.
// ============================================================================

import { NextRequest, NextResponse } from "next/server";
import {
  requireInternalAuth,
  claimBuild,
  reportStatus,
  reportFailureQuietly,
  dispatchToN8n,
  adminClient,
  type ClaimedBuild,
} from "@/lib/internal/guard";
import { renderDefinition } from "@/lib/internal/render";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Rendering plus the n8n handoff. Well clear of the actual cost, but generous
// enough that a cold start on the renderer package doesn't trip it.
export const maxDuration = 120;

/**
 * Process one claimed build end to end.
 *
 * Every failure path after the claim MUST report 'failed' with the claim token.
 * Otherwise the build sits non-terminal, and builds_one_active_per_site blocks
 * the site from publishing again until the reaper fires 15 minutes later.
 */
async function processBuild(build: ClaimedBuild): Promise<void> {
  const { build_id: buildId, claim_token: claimToken } = build;

  // ---- Validate ----
  try {
    await reportStatus(buildId, claimToken, "validating");
  } catch (err) {
    // Failing here means the token is already stale — another worker owns this
    // build. Bail without reporting, since our token would be rejected anyway.
    console.warn(`[dispatch] lost claim on ${buildId}:`, err);
    return;
  }

  // ---- Render ----
  let rendered: Awaited<ReturnType<typeof renderDefinition>>;

  try {
    await reportStatus(buildId, claimToken, "rendering");

    // In-process call, not an HTTP round trip to /api/internal/render. Same
    // function, no serialisation of a large document through localhost.
    rendered = await renderDefinition(build.definition, {
      rendererKey: build.renderer_key,
      strict:      true,   // the build path never ships invalid content
    });
  } catch (err) {
    const issues = (err as Error & { issues?: unknown }).issues;

    await reportFailureQuietly(
      buildId, 
      claimToken, 
      issues ? "validation" : "render",
      err,
      issues ? { validation_issues: issues } : undefined,
    );

    
    return;
  }

  // ---- Hand off ----
  try {
    // Only send the CSP when it differs from what the distribution already
    // carries. After the first publish this is almost always null, so n8n skips
    // the UpdateResponseHeadersPolicy call entirely.
    const { data: site } = await adminClient()
      .from("sites")
      .select("csp_current, response_headers_policy_id")
      .eq("id", build.site_id)
      .single();

    const cspChanged =
      site?.csp_current === rendered.csp ? null : rendered.csp;

    await dispatchToN8n({
      buildId,
      claimToken,
      siteId:                  build.site_id,
      s3Prefix:                build.s3_prefix,
      distributionId:          build.distribution_id,
      responseHeadersPolicyId: site?.response_headers_policy_id ?? null,
      html:                    rendered.html,
      assetManifest:           rendered.assetManifest,
      cspChanged,
      callbackUrl:             `${process.env.APP_URL}/api/internal/builds/${buildId}/status`,
      deriveUrl:              `${process.env.APP_URL}/api/internal/media/derive`,
    });

    // n8n now owns the build and reports 'uploading' onward. We deliberately
    // do NOT set 'uploading' here — that transition marks n8n actually
    // starting work, and claiming it early would hide a webhook that was
    // accepted but never processed.
  } catch (err) {
    await reportFailureQuietly(buildId, claimToken, "handoff", err);
  }
}

// ============================================================================
// ROUTE
// ============================================================================

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

  // Drain up to `max` builds per invocation. 1 for the publish trigger (claim
  // exactly the build just queued); higher for the sweep, to clear a backlog.
  const max = Math.min(Math.max(body.max ?? 1, 1), 10);

  const processed: string[] = [];

  try {
    for (let i = 0; i < max; i++) {
      const build = await claimBuild(workerId);
      if (!build) break;   // queue empty

      // Sequential, not Promise.all. Concurrent renders on one instance blow
      // memory on image-heavy definitions, and the queue is rarely deep enough
      // for the parallelism to matter.
      await processBuild(build);
      processed.push(build.build_id);
    }

    return NextResponse.json(
      { claimed: processed.length, buildIds: processed },
      { status: 200 },
    );
  } catch (err) {
    // A throw here means claimBuild itself failed — the database is
    // unreachable, not a build-specific problem. Nothing is claimed, so
    // nothing is stranded.
    console.error("[dispatch] claim loop failed:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Dispatch failed",
        claimed: processed.length },
      { status: 500 },
    );
  }
}
