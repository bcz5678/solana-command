// ============================================================================
// app/dev/sites/page.tsx
//
// Admin prune page. Dev-only.
//
// Answers "what's the state of everything, and what needs cleaning up" —
// distinct from the per-site dev panel, which answers "unstick this one".
//
// The route it calls 404s in production; this page checks NODE_ENV too so it
// fails at the door rather than with an unexplained fetch error.
// ============================================================================

"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

// ============================================================================
// TYPES
// ============================================================================

type BulkAction =
  | "cancel_runs"
  | "release_domain_claim"
  | "unblock_provisioning"
  | "reset_provisioning"
  | "reset_builds"
  | "reset_site_full"
  | "discard_draft_site"
  | "force_draft_site"
  | "force_discard_site";

interface ActiveRun {
  run_id: string;
  run_kind: string;
  status: string;
  blocked_step: string | null;
  is_stale: boolean;
}

interface AdminSite {
  id: string;
  name: string;
  token_symbol: string | null;
  domain: string | null;
  s3_prefix: string | null;
  provisioning_status: string;
  distribution_id: string | null;
  cert_arn: string | null;
  published_at: string | null;
  updated_at: string;
  activeRuns: ActiveRun[];
  applicable: BulkAction[];
  flags: string[];
}

interface BulkResult {
  action: string;
  succeeded: number;
  failed: number;
  results: Array<{ siteId: string; name: string; ok: boolean; error?: string }>;
  cleanupScript: string | null;
}

const ACTION_LABELS: Record<BulkAction, string> = {
  cancel_runs:          "Cancel runs",
  release_domain_claim: "Release domain",
  unblock_provisioning: "Clear block",
  reset_provisioning:   "Reset provisioning",
  reset_builds:         "Reset builds",
  reset_site_full:      "Reset everything",
  discard_draft_site:   "Discard site",
  force_draft_site:   "Force to draft",
  force_discard_site: "Force delete",
};

/** Actions that leave AWS resources behind, or delete rows. */
const DESTRUCTIVE = new Set<BulkAction>([
  "reset_provisioning",
  "reset_builds",
  "reset_site_full",
  "force_discard_site",
]);

const FLAG_LABELS: Record<string, string> = {
  "blocked":                 "Blocked",
  "running":                 "Running",
  "stale-draft":             "Stale draft",
  "orphaned-aws":            "Orphaned AWS",
  "provisioned-unpublished": "Never published",
  "domain-released":         "Domain released",
};

// ============================================================================
// PAGE
// ============================================================================

export default function DevSitesPage() {
  const [sites, setSites] = useState<AdminSite[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState<BulkAction | null>(null);
  const [result, setResult] = useState<BulkResult | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/dev/sites", { credentials: "same-origin" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `Failed to load (${res.status})`);
      }
      setSites((await res.json()).sites);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const visible = useMemo(
    () => (filter ? sites.filter((s) => s.flags.includes(filter)) : sites),
    [sites, filter],
  );

  /**
   * Only actions applicable to EVERY selected site.
   *
   * A bulk action across a selection spanning a live site and three drafts
   * should not silently do different things to each — so the intersection is
   * what gets offered.
   */
  const availableActions = useMemo(() => {
    const chosen = sites.filter((s) => selected.has(s.id));
    if (chosen.length === 0) return [] as BulkAction[];

    return chosen
      .map((s) => new Set(s.applicable))
      .reduce<BulkAction[]>(
        (acc, set) => acc.filter((a) => set.has(a)),
        [...chosen[0]!.applicable],
      );
  }, [sites, selected]);

  const flagCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const site of sites) {
      for (const flag of site.flags) counts.set(flag, (counts.get(flag) ?? 0) + 1);
    }
    return counts;
  }, [sites]);

  async function runBulk(action: BulkAction) {
    if (DESTRUCTIVE.has(action) && confirming !== action) {
      setConfirming(action);
      setTimeout(() => setConfirming((c) => (c === action ? null : c)), 5000);
      return;
    }

    setConfirming(null);
    setBusy(true);
    setResult(null);

    try {
      const res = await fetch("/api/dev/sites", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ action, siteIds: [...selected] }),
      });

      const json = await res.json().catch(() => null);

      if (!res.ok) {
        setError(json?.error ?? `Failed (${res.status})`);
        return;
      }

      setResult(json as BulkResult);
      setSelected(new Set());
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  if (process.env.NODE_ENV === "production") {
    return <p className="p-8 text-sm">Not available.</p>;
  }

  return (
    <div className="mx-auto max-w-7xl space-y-6 p-6">
      <header className="flex items-baseline justify-between">
        <div>
          <h1 className="text-xl font-semibold">Site inventory</h1>
          <p className="text-sm text-muted-foreground">
            Development only. Resets here do not touch AWS — use the generated
            cleanup script.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          className="rounded border px-3 py-1 text-sm"
        >
          Refresh
        </button>
      </header>

      {/* ---- Filters ---- */}
      <div className="flex flex-wrap gap-2">
        <FilterChip
          label={`All (${sites.length})`}
          active={filter === null}
          onClick={() => setFilter(null)}
        />
        {[...flagCounts.entries()]
          .sort((a, b) => b[1] - a[1])
          .map(([flag, count]) => (
            <FilterChip
              key={flag}
              label={`${FLAG_LABELS[flag] ?? flag} (${count})`}
              active={filter === flag}
              danger={flag === "orphaned-aws" || flag === "blocked"}
              onClick={() => setFilter(filter === flag ? null : flag)}
            />
          ))}
      </div>

      {error && (
        <pre className="whitespace-pre-wrap rounded bg-red-500/10 p-3 text-sm text-red-700">
          {error}
        </pre>
      )}

      {/* ---- Bulk bar ---- */}
      {selected.size > 0 && (
        <div className="sticky top-0 z-10 flex flex-wrap items-center gap-2 rounded border bg-background/95 p-3 shadow-sm backdrop-blur">
          <span className="text-sm font-medium">{selected.size} selected</span>

          {availableActions.length === 0 ? (
            <span className="text-sm text-muted-foreground">
              No action applies to every selected site — narrow the selection.
            </span>
          ) : (
            availableActions.map((action) => (
              <button
                key={action}
                type="button"
                disabled={busy}
                onClick={() => void runBulk(action)}
                className={[
                  "rounded border px-2 py-1 text-xs",
                  DESTRUCTIVE.has(action) ? "border-red-500/50 text-red-600" : "",
                  confirming === action ? "bg-red-500/20" : "",
                  busy ? "opacity-50" : "",
                ].join(" ")}
              >
                {confirming === action
                  ? `Confirm — ${selected.size} sites?`
                  : ACTION_LABELS[action]}
              </button>
            ))
          )}

          <button
            type="button"
            onClick={() => setSelected(new Set())}
            className="ml-auto text-xs underline"
          >
            Clear
          </button>
        </div>
      )}

      {/* ---- Table ---- */}
      {loading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : (
        <table className="w-full text-left text-sm">
          <thead className="border-b text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="w-8 py-2">
                <input
                  type="checkbox"
                  checked={visible.length > 0 && visible.every((s) => selected.has(s.id))}
                  onChange={(e) =>
                    setSelected(e.target.checked ? new Set(visible.map((s) => s.id)) : new Set())
                  }
                />
              </th>
              <th className="py-2">Site</th>
              <th className="py-2">Status</th>
              <th className="py-2">Domain</th>
              <th className="py-2">AWS</th>
              <th className="py-2">Flags</th>
              <th className="py-2">Updated</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((site) => (
              <tr key={site.id} className="border-b last:border-0">
                <td className="py-2">
                  <input
                    type="checkbox"
                    checked={selected.has(site.id)}
                    onChange={(e) => {
                      const next = new Set(selected);
                      if (e.target.checked) next.add(site.id);
                      else next.delete(site.id);
                      setSelected(next);
                    }}
                  />
                </td>
                <td className="py-2">
                  <div className="font-medium">{site.name}</div>
                  <div className="font-mono text-xs text-muted-foreground">
                    {site.s3_prefix ?? "—"}
                  </div>
                </td>
                <td className="py-2">
                  <div>{site.provisioning_status}</div>
                  {site.activeRuns.map((run) => (
                    <div
                      key={run.run_id}
                      className={`text-xs ${run.is_stale ? "text-red-600" : "text-muted-foreground"}`}
                    >
                      {run.run_kind} · {run.status}
                      {run.blocked_step ? ` @ ${run.blocked_step}` : ""}
                      {run.is_stale ? " (stale)" : ""}
                    </div>
                  ))}
                </td>
                <td className="py-2 font-mono text-xs">{site.domain ?? "—"}</td>
                <td className="py-2 font-mono text-xs">
                  {/* The two columns that decide whether cleanup is needed. */}
                  <div>{site.distribution_id ?? "—"}</div>
                  <div className="text-muted-foreground">
                    {site.cert_arn ? "cert" : "—"}
                  </div>
                </td>
                <td className="py-2">
                  <div className="flex flex-wrap gap-1">
                    {site.flags.map((flag) => (
                      <span
                        key={flag}
                        className={[
                          "rounded px-1 py-0.5 text-[10px]",
                          flag === "orphaned-aws" || flag === "blocked"
                            ? "bg-red-500/15 text-red-700"
                            : "bg-muted",
                        ].join(" ")}
                      >
                        {FLAG_LABELS[flag] ?? flag}
                      </span>
                    ))}
                  </div>
                </td>
                <td className="py-2 text-xs text-muted-foreground">
                  {new Date(site.updated_at).toLocaleDateString()}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {/* ---- Result ---- */}
      {result && (
        <div className="space-y-3 rounded border p-4">
          <p className="text-sm">
            <strong>{ACTION_LABELS[result.action as BulkAction]}</strong> —{" "}
            {result.succeeded} succeeded
            {result.failed > 0 ? `, ${result.failed} failed` : ""}
          </p>

          {result.results.filter((r) => !r.ok).map((r) => (
            <p key={r.siteId} className="text-xs text-red-700">
              {r.name}: {r.error}
            </p>
          ))}

          {/* The step that gets skipped, and skipping it is what produces the
              confusing failure on the next run. */}
          {result.cleanupScript && (
            <div className="space-y-2 rounded border border-red-500/40 bg-red-500/5 p-3">
              <div className="flex items-center justify-between">
                <p className="font-mono text-xs uppercase tracking-wide text-red-600">
                  AWS resources still exist
                </p>
                <button
                  type="button"
                  onClick={() => navigator.clipboard.writeText(result.cleanupScript!)}
                  className="rounded border px-2 py-1 text-xs"
                >
                  Copy script
                </button>
              </div>
              <p className="text-xs">
                A leftover CloudFront alias blocks the domain from being re-added
                anywhere in the account — the next run would fail at
                distribution_configure with what reads like a permissions error.
              </p>
              <pre className="max-h-96 overflow-auto rounded bg-black/10 p-2 text-[11px]">
                {result.cleanupScript}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function FilterChip({
  label, active, danger, onClick,
}: {
  label: string;
  active: boolean;
  danger?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        "rounded-full border px-3 py-1 text-xs",
        active ? "bg-foreground text-background" : "",
        danger && !active ? "border-red-500/50 text-red-600" : "",
      ].join(" ")}
    >
      {label}
    </button>
  );
}
