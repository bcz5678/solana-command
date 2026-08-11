// ============================================================================
// components/dev/dev-site-panel.tsx
//
// Collapsible recovery panel for the site builder wizard.
//
// Mount at the bottom of the wizard shell:
//
//   {process.env.NODE_ENV !== "production" && siteId && (
//     <DevSitePanel siteId={siteId} onChanged={refresh} />
//   )}
//
// The NODE_ENV guard at the CALL SITE matters as much as the one inside: it
// lets the bundler drop the import entirely in a production build, so the
// component never ships.
//
// Shows current site state — which is half the value. Most stuck states are
// obvious once provisioning_status and the active run are visible side by side.
// ============================================================================

"use client";

import { useCallback, useEffect, useState } from "react";

// ============================================================================
// TYPES
// ============================================================================

interface SiteState {
  id: string;
  name: string;
  domain: string | null;
  domain_source: string | null;
  s3_prefix: string | null;
  provisioning_status: string;
  distribution_id: string | null;
  cert_arn: string | null;
  published_at: string | null;
}

interface ActionResult {
  action: string;
  site: SiteState | null;
  result: Record<string, unknown>;
  awsCleanup: Array<{ label: string; command: string }>;
}

type ActionId =
  | "release_domain_claim"
  | "unblock_provisioning"
  | "cancel_runs"
  | "rewind_provisioning"
  | "reset_provisioning"
  | "reset_builds"
  | "reset_site_full"
  | "discard_draft_site";

interface ActionDef {
  id: ActionId;
  label: string;
  description: string;
  /** Destroys content or requires AWS cleanup afterwards. */
  danger?: boolean;
  needsStep?: boolean;
}

/**
 * Ordered least to most destructive, which is the order someone should try
 * them in. The top three fix the great majority of stuck states.
 */
const ACTIONS: ActionDef[] = [
  {
    id: "release_domain_claim",
    label: "Release domain",
    description:
      "Clears the domain so another can be chosen. Drafts only — a provisioned site needs teardown.",
  },
  {
    id: "unblock_provisioning",
    label: "Clear block",
    description:
      "Drops the events causing a blocked run and re-queues it. Skips the confirm/retry audit trail.",
  },
  {
    id: "cancel_runs",
    label: "Cancel active runs",
    description:
      'Fixes "a run is already in progress" when the run is actually dead and the reaper has not caught up.',
  },
  {
    id: "rewind_provisioning",
    label: "Rewind to step",
    description:
      "Deletes events from a step onward so it replays. Usually better than a full reset.",
    needsStep: true,
  },
  {
    id: "reset_provisioning",
    label: "Reset provisioning",
    description:
      "Deletes all provisioning events and runs. Keeps the domain and s3_prefix.",
    danger: true,
  },
  {
    id: "reset_builds",
    label: "Reset builds",
    description: "Deletes builds and clears the published pointer. Keeps versions.",
    danger: true,
  },
  {
    id: "reset_site_full",
    label: "Reset everything",
    description: "Provisioning, builds and versions. Keeps the site row and its draft.",
    danger: true,
  },
  {
    id: "discard_draft_site",
    label: "Discard site",
    description: "Deletes the site row entirely. Drafts only.",
    danger: true,
  },
];

const STEPS = [
  "s3_folder",
  "cert_request",
  "cert_validation_records",
  "dns_host_records",
  "cert_validation_wait",
  "distribution_configure",
  "distribution_deploy",
  "ready",
];

// ============================================================================
// COMPONENT
// ============================================================================

export function DevSitePanel({
  siteId,
  onChanged,
}: {
  siteId: string;
  /** Called after a successful action so the wizard refetches. */
  onChanged?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [site, setSite] = useState<SiteState | null>(null);
  const [busy, setBusy] = useState<ActionId | null>(null);
  const [result, setResult] = useState<ActionResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [step, setStep] = useState(STEPS[0]!);
  const [confirming, setConfirming] = useState<ActionId | null>(null);

  const loadState = useCallback(async () => {
    try {
      const res = await fetch(`/api/sites/${siteId}`, { credentials: "same-origin" });
      if (res.ok) setSite((await res.json()).site);
    } catch {
      // State display is a convenience; a failure here should not break the panel.
    }
  }, [siteId]);

  useEffect(() => {
    if (open) void loadState();
  }, [open, loadState]);

  async function run(action: ActionId) {
    const def = ACTIONS.find((a) => a.id === action)!;

    // Two-click confirm on destructive actions. Deliberately not window.confirm:
    // that steals focus and is easy to dismiss reflexively.
    if (def.danger && confirming !== action) {
      setConfirming(action);
      setTimeout(() => setConfirming((c) => (c === action ? null : c)), 4000);
      return;
    }

    setConfirming(null);
    setBusy(action);
    setError(null);
    setResult(null);

    try {
      const res = await fetch("/api/dev/site-actions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({
          action,
          siteId,
          ...(def.needsStep ? { fromStep: step } : {}),
        }),
      });

      const json = await res.json().catch(() => null);

      if (!res.ok) {
        setError(json?.error ?? `Failed (${res.status})`);
        if (json?.hint) setError((e) => `${e}\n${json.hint}`);
        return;
      }

      setResult(json as ActionResult);
      await loadState();
      onChanged?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="mt-8 rounded border border-amber-500/40 bg-amber-500/5 text-sm">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between px-4 py-2 text-left font-mono text-xs uppercase tracking-wide text-amber-600"
      >
        <span>Dev tools {site ? `— ${site.provisioning_status}` : ""}</span>
        <span>{open ? "−" : "+"}</span>
      </button>

      {open && (
        <div className="space-y-4 border-t border-amber-500/30 px-4 py-4">
          {/* ---- State ----
              Half the value of this panel. Most stuck states are obvious the
              moment provisioning_status and the domain are visible together. */}
          {site && (
            <dl className="grid grid-cols-[10rem_1fr] gap-x-4 gap-y-1 font-mono text-xs">
              <dt className="text-muted-foreground">site</dt>
              <dd className="truncate">{site.id}</dd>
              <dt className="text-muted-foreground">status</dt>
              <dd>{site.provisioning_status}</dd>
              <dt className="text-muted-foreground">domain</dt>
              <dd>{site.domain ?? "—"} {site.domain_source ? `(${site.domain_source})` : ""}</dd>
              <dt className="text-muted-foreground">prefix</dt>
              <dd>{site.s3_prefix ?? "—"}</dd>
              <dt className="text-muted-foreground">distribution</dt>
              <dd>{site.distribution_id ?? "—"}</dd>
              <dt className="text-muted-foreground">cert</dt>
              <dd className="truncate">{site.cert_arn ?? "—"}</dd>
              <dt className="text-muted-foreground">published</dt>
              <dd>{site.published_at ?? "—"}</dd>
            </dl>
          )}

          {/* ---- Actions ---- */}
          <div className="space-y-2">
            {ACTIONS.map((action) => (
              <div key={action.id} className="flex items-start gap-3">
                <button
                  type="button"
                  disabled={busy !== null}
                  onClick={() => run(action.id)}
                  className={[
                    "shrink-0 rounded px-2 py-1 font-mono text-xs",
                    action.danger
                      ? "border border-red-500/50 text-red-600"
                      : "border border-amber-500/50 text-amber-700",
                    confirming === action.id ? "bg-red-500/20" : "",
                    busy ? "opacity-50" : "",
                  ].join(" ")}
                >
                  {busy === action.id
                    ? "..."
                    : confirming === action.id
                      ? "Confirm?"
                      : action.label}
                </button>

                {action.needsStep && (
                  <select
                    value={step}
                    onChange={(e) => setStep(e.target.value)}
                    className="shrink-0 rounded border px-1 py-0.5 font-mono text-xs"
                  >
                    {STEPS.map((s) => (
                      <option key={s} value={s}>{s}</option>
                    ))}
                  </select>
                )}

                <p className="text-xs text-muted-foreground">{action.description}</p>
              </div>
            ))}
          </div>

          {/* ---- Errors ---- */}
          {error && (
            <pre className="whitespace-pre-wrap rounded bg-red-500/10 p-2 text-xs text-red-700">
              {error}
            </pre>
          )}

          {/* ---- Result ---- */}
          {result && (
            <div className="space-y-3">
              <pre className="max-h-40 overflow-auto rounded bg-black/5 p-2 text-xs">
                {JSON.stringify(result.result, null, 2)}
              </pre>

              {/* The step people skip. A leftover CloudFront alias blocks the
                  domain from being re-added ANYWHERE in the account, and the
                  next run fails with what looks like a permissions error. */}
              {result.awsCleanup.length > 0 && (
                <div className="space-y-2 rounded border border-red-500/40 bg-red-500/5 p-3">
                  <p className="font-mono text-xs uppercase tracking-wide text-red-600">
                    AWS resources still exist — clean up before re-running
                  </p>
                  {result.awsCleanup.map((c) => (
                    <div key={c.label} className="space-y-1">
                      <p className="text-xs">{c.label}</p>
                      <pre className="overflow-auto rounded bg-black/10 p-2 text-[11px]">
                        {c.command}
                      </pre>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
