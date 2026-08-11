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


/**
 * Poll intervals by run state.
 *
 * A run legitimately goes quiet for minutes during cert validation, so a fast
 * interval buys nothing there — but the first few seconds after a start are
 * when the user is watching hardest.
 */
const POLL_ACTIVE_MS = 1_500;    // queued | claimed | running
const POLL_BLOCKED_MS = 15_000;  // waiting on a human; nothing changes on its own
const POLL_IDLE_MS = 0;          // terminal — stop entirely
 
/** Give up after this long even if the run has not reached a terminal state. */
const MAX_POLL_MS = 90 * 60 * 1000;   // 90 min, past the 60-min reaper


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
  /**
   * Only supply alongside `domain`, when selecting for the first time.
   * `sites.domain_source` is authoritative once recorded — sending it
   * unconditionally can contradict what `select_domain` already wrote.
   */
  domainSource?: ProvisioningRun["domainSource"],
  domain?: string,
) {
  return post(siteId, {
    kind: "setup", distributionId, distributionUrl,
    ...(domain ? { domain } : {}),
    ...(domainSource ? { domainSource } : {}),
  });
}

/**
 * Records a domain the team already owns (or selected externally). Separate
 * from starting a run because selecting a domain is reversible while a run
 * is not — see `POST /api/sites/:siteId/domain`.
 */
export async function selectDomain(
  siteId: string,
  domain: string,
  domainSource: "in_account" | "external" = "in_account",
  detail?: Record<string, unknown>,
) {
  const res = await fetch(`/api/sites/${siteId}/domain`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "same-origin",
    body: JSON.stringify({ domain, domainSource, detail }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error ?? `Failed to select domain (${res.status})`);
  return json as { site_id: string; domain: string; domainSource: string; reclaimed: boolean };
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

function intervalFor(status: string | undefined): number {
  if (!status) return POLL_ACTIVE_MS;
 
  if (["completed", "failed", "cancelled"].includes(status)) return POLL_IDLE_MS;
  if (status === "blocked") return POLL_BLOCKED_MS;
 
  return POLL_ACTIVE_MS;
}
 
export function useProvisioning(siteId: string | undefined) {
  const [runs, setRuns] = useState<ProvisioningRun[]>([]);
  const [loading, setLoading] = useState(Boolean(siteId));
  const [error, setError] = useState<Error | null>(null);
 
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const startedAt = useRef<number>(Date.now());
  // Guards against a slow response landing after unmount, and against two
  // fetches overlapping if one hangs.
  const inFlight = useRef(false);
  const cancelled = useRef(false);
 
  const load = useCallback(async (): Promise<ProvisioningRun[]> => {
    if (!siteId || inFlight.current) return [];
 
    inFlight.current = true;
    try {
      const next = await fetchProvisioning(siteId);
      if (!cancelled.current) {
        setRuns(next);
        setError(null);
      }
      return next;
    } catch (err) {
      if (!cancelled.current) {
        // Keep the last good state visible. A transient network failure mid-run
        // should not blank a timeline the user is reading.
        setError(err instanceof Error ? err : new Error(String(err)));
      }
      return [];
    } finally {
      inFlight.current = false;
      if (!cancelled.current) setLoading(false);
    }
  }, [siteId]);
 
  useEffect(() => {
    if (!siteId) {
      setRuns([]);
      setLoading(false);
      return;
    }
 
    cancelled.current = false;
    startedAt.current = Date.now();
 
    const tick = async () => {
      const next = await load();
      if (cancelled.current) return;
 
      const status = next[0]?.status;
      const wait = intervalFor(status);
 
      // Terminal: stop. Nothing further will change without a user action, and
      // those actions call refresh() themselves.
      if (wait === POLL_IDLE_MS) return;
 
      // Safety valve. A run stuck past the reaper window means something is
      // wrong upstream; polling forever would not help.
      if (Date.now() - startedAt.current > MAX_POLL_MS) {
        setError(new Error("Stopped polling — the run has not completed in 90 minutes."));
        return;
      }
 
      timer.current = setTimeout(tick, wait);
    };
 
    void tick();
 
    return () => {
      cancelled.current = true;
      if (timer.current) clearTimeout(timer.current);
    };
  }, [siteId, load]);
 
  /**
   * Manual refresh, and a restart of the poll loop.
   *
   * Call this after any action that changes run state — starting a run,
   * resolving a block — so a terminal-then-restarted run resumes polling
   * rather than staying stopped.
   */
  const refresh = useCallback(async () => {
    if (timer.current) clearTimeout(timer.current);
    startedAt.current = Date.now();
 
    const next = await load();
 
    if (!cancelled.current && intervalFor(next[0]?.status) !== POLL_IDLE_MS) {
      timer.current = setTimeout(async function again() {
        const latest = await load();
        if (cancelled.current) return;
        const wait = intervalFor(latest[0]?.status);
        if (wait !== POLL_IDLE_MS) timer.current = setTimeout(again, wait);
      }, intervalFor(next[0]?.status));
    }
  }, [load]);
 
  const current = runs[0] ?? null;
 
  return {
    runs,
    current,
    loading,
    error,
    refresh,
 
    isBlocked: current?.status === "blocked",
    isRunning: current ? ["queued", "claimed", "running"].includes(current.status) : false,
    isComplete: current?.status === "completed",
    isFailed: current?.status === "failed",
    /** True while the poll loop is live. Useful for a subtle activity indicator. */
    isPolling: current ? intervalFor(current.status) !== POLL_IDLE_MS : false,
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
    // Terminal status wins regardless of arrival order. n8n fires callbacks as
    // separate requests, so a 'started' can land after its own 'succeeded' when
    // a step completes in tens of milliseconds — which distribution_configure
    // does. Taking the last event by time would leave the step spinning forever.
    const terminal = events
      .filter((e) => e.status !== "started")
      .at(-1);

    const last = terminal ?? events.at(-1);

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

export interface FailureGuidance {
  title: string;
  body: string;
  /** Diagnostic fields worth showing verbatim — certificateStatus, namecheapErrorCode, etc. */
  detail: Array<{ label: string; value: string }>;
  /**
   * The reaper case: the run went quiet, not "a step reported failure." AWS
   * resources from steps that already ran may still exist, so a bare retry
   * button here is how you end up with a second certificate — this makes
   * retrying require a deliberate acknowledgement instead of one click.
   */
  requiresAcknowledgement: boolean;
  acknowledgementLabel?: string;
}

const FAILURE_DETAIL_LABELS: Record<string, string> = {
  certificateStatus: "Certificate status",
  namecheapErrorCode: "Namecheap error code",
};

/** Keys already surfaced elsewhere (title/body) — not worth repeating in the detail list. */
const FAILURE_DETAIL_IGNORED_KEYS = new Set(["message", "source", "reason", "node", "nodeName", "phase", "kind"]);

/**
 * What to tell the operator about a failed run.
 *
 * Three genuinely different situations hide behind the same `status ===
 * "failed"` — a workflow crash, a step that failed with a real diagnosis, and
 * the reaper timing out a run that went quiet. Collapsing them into one
 * generic "failed" message is how a heartbeat timeout gets misread as an
 * ordinary failure and retried blind.
 */
export function failureGuidance(run: ProvisioningRun): FailureGuidance {
  const detail = run.errorDetail ?? {};

  if (detail.reason === "heartbeat_timeout") {
    return {
      title: "The workflow stopped responding",
      body:
        "This run was stopped automatically after going quiet — no step reported a failure. " +
        "AWS resources from steps that already ran (certificate, distribution, DNS records) may " +
        "still exist. Check the AWS console before retrying; retrying blind risks creating duplicates.",
      detail: [],
      requiresAcknowledgement: true,
      acknowledgementLabel: "I checked AWS and no duplicate resources were left behind",
    };
  }

  if (detail.source === "error-workflow") {
    const node =
      typeof detail.node === "string" ? detail.node
      : typeof detail.nodeName === "string" ? detail.nodeName
      : "an unknown node";
    return {
      title: "Unexpected error",
      body: `The workflow crashed in "${node}" rather than reporting a normal step failure.`,
      detail: [],
      requiresAcknowledgement: false,
    };
  }

  const diagnostic = Object.entries(detail)
    .filter((e): e is [string, string | number] =>
      !FAILURE_DETAIL_IGNORED_KEYS.has(e[0]) && (typeof e[1] === "string" || typeof e[1] === "number"))
    .map(([key, value]) => ({ label: FAILURE_DETAIL_LABELS[key] ?? key, value: String(value) }));

  return {
    title: "Step failed",
    body:
      typeof detail.message === "string"
        ? detail.message
        : "This step reported a failure. Retrying may not resolve it — check the cause below first.",
    detail: diagnostic,
    requiresAcknowledgement: false,
  };
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