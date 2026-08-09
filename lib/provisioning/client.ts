// ============================================================================
// lib/provisioning/client.ts
//
// Typed access to provisioning state, plus a Realtime hook for the wizard.
//
// The wizard renders a TIMELINE, not a status: a resolved plan (what will run,
// what is skipped and why) interleaved with events (what actually happened).
// That pairing is what makes a 15-minute cert wait legible instead of looking
// like a hang.
// ============================================================================

"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";

// ============================================================================
// TYPES
// ============================================================================

export type ProvisioningStep =
  | "domain_search"
  | "domain_check_account"
  | "domain_purchase"
  | "s3_folder"
  | "cert_request"
  | "cert_validation_records"
  | "dns_host_records"
  | "cert_validation_wait"
  | "distribution_configure"
  | "distribution_deploy"
  | "ready";

export type EventStatus = "started" | "succeeded" | "failed" | "skipped" | "blocked";

export type RunStatus =
  | "queued" | "claimed" | "running" | "blocked"
  | "completed" | "failed" | "cancelled";

export interface PlanEntry {
  step: ProvisioningStep;
  action: "run" | "skip" | "block";
  reason: string;
}

export interface ProvisioningEvent {
  step: ProvisioningStep;
  status: EventStatus;
  detail: Record<string, unknown>;
  durationMs: number | null;
  at: string;
}

export interface ProvisioningRun {
  id: string;
  kind: "purchase" | "setup";
  status: RunStatus;
  domain: string;
  domainSource: "purchase" | "in_account" | "external";
  distributionId: string | null;
  distributionUrl: string | null;
  originPath: string | null;
  blockedStep: ProvisioningStep | null;
  blockedReason: string | null;
  blockedDetail: Record<string, unknown> | null;
  errorDetail: Record<string, unknown> | null;
  queuedAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  plan: PlanEntry[];
  events: ProvisioningEvent[];
}

// ============================================================================
// LABELS
// ============================================================================

/** Human labels. Kept here rather than in components so they stay consistent. */
export const STEP_LABELS: Record<ProvisioningStep, string> = {
  domain_search:           "Search for domain",
  domain_check_account:    "Check existing account",
  domain_purchase:         "Purchase domain",
  s3_folder:               "Create site folder",
  cert_request:            "Request certificate",
  cert_validation_records: "Read validation records",
  dns_host_records:        "Write DNS records",
  cert_validation_wait:    "Validate certificate",
  distribution_configure:  "Configure distribution",
  distribution_deploy:     "Deploy distribution",
  ready:                   "Finish",
};

/**
 * Steps that legitimately take minutes. The UI should show elapsed time and an
 * explanation for these rather than a spinner — a silent 15-minute wait reads
 * as a hang, and someone will reload or re-run.
 */
export const SLOW_STEPS = new Set<ProvisioningStep>([
  "cert_validation_wait",
  "distribution_deploy",
]);

// ============================================================================
// FETCHERS
// ============================================================================

export async function fetchProvisioning(siteId: string): Promise<ProvisioningRun[]> {
  const res = await fetch(`/api/sites/${siteId}/provisioning`, {
    credentials: "same-origin",
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `Failed to load provisioning (${res.status})`);
  }

  return (await res.json()).runs as ProvisioningRun[];
}

export async function startPurchase(siteId: string, domain: string) {
  return post(siteId, { kind: "purchase", domain });
}

export async function startSetup(
  siteId: string,
  distributionId: string,
  distributionUrl: string,
  domainSource: ProvisioningRun["domainSource"] = "purchase",
) {
  return post(siteId, { kind: "setup", distributionId, distributionUrl, domainSource });
}

async function post(siteId: string, body: Record<string, unknown>) {
  const res = await fetch(`/api/sites/${siteId}/provisioning`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "same-origin",
    body: JSON.stringify(body),
  });

  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error ?? `Failed to start (${res.status})`);

  return json as { run_id: string; status: string; message?: string; duplicate?: boolean };
}

export async function resolveBlock(
  siteId: string,
  runId: string,
  resolution: "confirm" | "retry" | "abandon",
  note?: string,
  detail?: Record<string, unknown>,
) {
  const res = await fetch(`/api/sites/${siteId}/provisioning/resolve`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "same-origin",
    body: JSON.stringify({ runId, resolution, note, detail }),
  });

  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error ?? `Failed to resolve (${res.status})`);

  return json as { run_id: string; status: string; resolution?: string };
}

// ============================================================================
// REALTIME HOOK
// ============================================================================

export function useProvisioning(siteId: string | undefined) {
  const [runs, setRuns] = useState<ProvisioningRun[]>([]);
  const [loading, setLoading] = useState(Boolean(siteId));
  const [error, setError] = useState<Error | null>(null);

  // Debounce refetches: a burst of events (started + succeeded within a second)
  // would otherwise fire several overlapping requests.
  const refetchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async () => {
    if (!siteId) return;
    try {
      setRuns(await fetchProvisioning(siteId));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err : new Error(String(err)));
    } finally {
      setLoading(false);
    }
  }, [siteId]);

  useEffect(() => {
    if (!siteId) {
      setRuns([]);
      setLoading(false);
      return;
    }

    void load();

    const supabase = createClient();

    /*
     * Refetch on change rather than patching local state from the payload.
     *
     * The payload carries one row; the wizard needs the RESOLVED PLAN, which
     * is computed server-side from all events for the site. Reconstructing it
     * client-side would be a second implementation of provisioning_plan's
     * rules — exactly the drift this architecture avoids elsewhere.
     *
     * Refetching is a few hundred bytes every few seconds during a run, and
     * nothing at all once it completes.
     */
    const channel = supabase
      .channel(`provisioning:${siteId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "private",
          table: "provisioning_events",
          filter: `site_id=eq.${siteId}`,
        },
        () => {
          if (refetchTimer.current) clearTimeout(refetchTimer.current);
          refetchTimer.current = setTimeout(() => void load(), 250);
        },
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "private",
          table: "provisioning_runs",
          filter: `site_id=eq.${siteId}`,
        },
        () => {
          if (refetchTimer.current) clearTimeout(refetchTimer.current);
          refetchTimer.current = setTimeout(() => void load(), 250);
        },
      )
      .subscribe();

    return () => {
      if (refetchTimer.current) clearTimeout(refetchTimer.current);
      void supabase.removeChannel(channel);
    };
  }, [siteId, load]);

  const current = runs[0] ?? null;

  return {
    runs,
    /** Most recent run. What the wizard shows by default. */
    current,
    loading,
    error,
    refresh: load,

    isBlocked: current?.status === "blocked",
    isRunning: current ? ["queued", "claimed", "running"].includes(current.status) : false,
    isComplete: current?.status === "completed",
    isFailed: current?.status === "failed",
  };
}

// ============================================================================
// TIMELINE
// ============================================================================

export interface TimelineEntry {
  step: ProvisioningStep;
  label: string;
  action: PlanEntry["action"];
  reason: string;
  /** succeeded | failed | skipped | blocked | running | pending */
  state: "pending" | "running" | "succeeded" | "failed" | "skipped" | "blocked";
  events: ProvisioningEvent[];
  startedAt: string | null;
  finishedAt: string | null;
  durationMs: number | null;
  /** True while a slow step is in flight — show elapsed time, not a spinner. */
  isSlow: boolean;
  attempts: number;
}

/**
 * Merge a run's plan and events into what the UI renders.
 *
 * The plan supplies the full ordered step list including skips; the events
 * supply what actually happened. Rendering events alone would omit steps that
 * have not started, so the wizard would appear to have fewer stages than it does.
 */
export function buildTimeline(run: ProvisioningRun | null): TimelineEntry[] {
  if (!run) return [];

  const byStep = new Map<ProvisioningStep, ProvisioningEvent[]>();
  for (const event of run.events) {
    const list = byStep.get(event.step) ?? [];
    list.push(event);
    byStep.set(event.step, list);
  }

  return run.plan.map((entry) => {
    const events = byStep.get(entry.step) ?? [];
    const last = events[events.length - 1];

    let state: TimelineEntry["state"] = "pending";

    if (entry.action === "skip") {
      state = "skipped";
    } else if (last?.status === "succeeded") {
      state = "succeeded";
    } else if (last?.status === "failed") {
      state = "failed";
    } else if (last?.status === "blocked" || entry.action === "block") {
      state = "blocked";
    } else if (last?.status === "started") {
      state = "running";
    }

    const started = events.find((e) => e.status === "started")?.at ?? null;
    const finished = events.find((e) =>
      ["succeeded", "failed", "skipped"].includes(e.status))?.at ?? null;

    return {
      step: entry.step,
      label: STEP_LABELS[entry.step],
      action: entry.action,
      reason: entry.reason,
      state,
      events,
      startedAt: started,
      finishedAt: finished,
      durationMs: last?.durationMs ?? null,
      isSlow: state === "running" && SLOW_STEPS.has(entry.step),
      // cert_validation_wait reports 'started' once per poll, so this is the
      // poll count — worth surfacing on a long wait.
      attempts: events.filter((e) => e.status === "started").length,
    };
  });
}

/** Elapsed ms for a running step, for the "waiting 4m 12s" label. */
export function elapsedMs(entry: TimelineEntry): number | null {
  if (entry.state !== "running" || !entry.startedAt) return null;
  return Date.now() - new Date(entry.startedAt).getTime();
}

/**
 * What to tell the operator about a block.
 *
 * domain_purchase is the case that matters: the run died between the Namecheap
 * call and its result, so nothing knows whether money was spent.
 */
export function blockGuidance(run: ProvisioningRun): {
  title: string;
  body: string;
  confirmLabel: string;
  retryLabel: string;
  requiresNote: boolean;
} {
  if (run.blockedStep === "domain_purchase") {
    return {
      title: "Verify the domain purchase",
      body:
        `A previous attempt to purchase ${run.domain} did not report a result, ` +
        `so we cannot tell whether it went through. Check the Namecheap account ` +
        `before continuing — retrying could buy the domain a second time.`,
      confirmLabel: "It was purchased — continue",
      retryLabel: "It was not purchased — try again",
      requiresNote: true,
    };
  }

  return {
    title: `Action needed: ${STEP_LABELS[run.blockedStep ?? "ready"]}`,
    body: run.blockedReason ?? "This step needs manual confirmation before continuing.",
    confirmLabel: "Already done — continue",
    retryLabel: "Try again",
    requiresNote: false,
  };
}