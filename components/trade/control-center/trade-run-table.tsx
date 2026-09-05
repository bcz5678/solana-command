'use client'

import { Fragment, useEffect, useState } from 'react'
import type { TradeRun, TradeRunStep, TradeRunSurface, TradeRunStatus } from '@/lib/types/trade-run'

// No push event exists for "a run's step changed" — same reasoning as
// comment-activity-feed.tsx's own polling, mirrored here at the same cadence.
const POLL_MS = 5_000
// A running/paused run whose durable record hasn't moved in this long almost
// certainly lost its tab (refresh/crash) — pause/cancel requests below would
// just sit in `control` forever with nothing left to read them.
const STALE_MS = 60_000

const SURFACE_LABEL: Record<TradeRunSurface, string> = {
    staggered_buy:   'Staggered Buy',
    staggered_sell:  'Staggered Sell',
    bundle_buy:      'Bundle Buy',
    bundle_sell:     'Bundle Sell',
    launch_builder:  'Launch Builder',
}

// Whole-flow pause/resume only exists on the staggered wizard's execution
// loop. Launch Builder gets cancel only (see launch-builder.tsx's walk()).
// Bundle wizard chunks fire concurrently with no wait to interrupt — no
// remote control makes sense there at all, rows are read-only.
const PAUSABLE: TradeRunSurface[]  = ['staggered_buy', 'staggered_sell']
const CANCELLABLE: TradeRunSurface[] = ['staggered_buy', 'staggered_sell', 'launch_builder']

function statusColor(status: TradeRunStatus): string {
    if (status === 'running') return 'bg-blue-500'
    if (status === 'paused')  return 'bg-amber-500'
    if (status === 'done')    return 'bg-green-500'
    if (status === 'error')   return 'bg-destructive'
    return 'bg-muted-foreground/50' // cancelled
}

function stepStatusColor(status: TradeRunStep['status']): string {
    if (status === 'success')  return 'text-green-500'
    if (status === 'error')    return 'text-destructive'
    if (status === 'running')  return 'text-blue-500'
    if (status === 'cancelled' || status === 'skipped') return 'text-muted-foreground'
    return 'text-muted-foreground/50' // pending
}

function relativeAge(iso: string): string {
    const ms = Date.now() - new Date(iso).getTime()
    if (ms < 60_000) return `${Math.round(ms / 1000)}s ago`
    if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m ago`
    return `${Math.round(ms / 3_600_000)}h ago`
}

export default function TradeRunTable() {
    const [runs, setRuns]           = useState<TradeRun[]>([])
    const [loading, setLoading]     = useState(true)
    const [expandedId, setExpandedId] = useState<string | null>(null)
    const [steps, setSteps]         = useState<TradeRunStep[]>([])
    const [stepsLoading, setStepsLoading] = useState(false)
    const [busyId, setBusyId]       = useState<string | null>(null)

    async function refreshRuns() {
        try {
            const res = await fetch('/api/trade-runs?limit=100')
            if (!res.ok) return
            const data = await res.json()
            setRuns((data.runs ?? []) as TradeRun[])
        } catch {
            // keep showing the last known list on a transient fetch failure
        } finally {
            setLoading(false)
        }
    }

    async function refreshSteps(runId: string) {
        setStepsLoading(true)
        try {
            const res = await fetch(`/api/trade-runs/${runId}/steps`)
            if (res.ok) {
                const data = await res.json()
                setSteps((data.steps ?? []) as TradeRunStep[])
            }
        } catch {
            // leave whatever steps are already shown
        } finally {
            setStepsLoading(false)
        }
    }

    useEffect(() => {
        refreshRuns()
        const id = setInterval(refreshRuns, POLL_MS)
        return () => clearInterval(id)
    }, [])

    useEffect(() => {
        if (!expandedId) return
        refreshSteps(expandedId)
        const id = setInterval(() => refreshSteps(expandedId), POLL_MS)
        return () => clearInterval(id)
    }, [expandedId])

    function toggleExpand(runId: string) {
        setExpandedId((prev) => (prev === runId ? null : runId))
        setSteps([])
    }

    async function sendControl(runId: string, control: 'pause_requested' | 'resume_requested' | 'cancel_requested') {
        setBusyId(runId)
        try {
            await fetch(`/api/trade-runs/${runId}/control`, {
                method:  'POST',
                headers: { 'Content-Type': 'application/json' },
                body:    JSON.stringify({ control }),
            })
        } finally {
            setBusyId(null)
        }
    }

    async function markStopped(runId: string) {
        setBusyId(runId)
        try {
            await fetch(`/api/trade-runs/${runId}/finish`, {
                method:  'POST',
                headers: { 'Content-Type': 'application/json' },
                body:    JSON.stringify({ status: 'cancelled' }),
            })
            await refreshRuns()
        } finally {
            setBusyId(null)
        }
    }

    if (loading && runs.length === 0) {
        return <p className="text-xs text-muted-foreground">Loading…</p>
    }

    if (runs.length === 0) {
        return (
            <p className="text-xs text-muted-foreground">
                No runs yet — one appears here as soon as a staggered buy/sell, bundle trade, or launch-builder run starts.
            </p>
        )
    }

    return (
        <div className="rounded-lg border border-border overflow-hidden">
            <table className="w-full text-xs">
                <thead>
                    <tr className="bg-muted/30 border-b border-border">
                        <th className="px-3 py-2 text-left font-medium text-muted-foreground w-4"></th>
                        <th className="px-3 py-2 text-left font-medium text-muted-foreground">Run</th>
                        <th className="px-3 py-2 text-left font-medium text-muted-foreground">Surface</th>
                        <th className="px-3 py-2 text-right font-medium text-muted-foreground">Steps</th>
                        <th className="px-3 py-2 text-left font-medium text-muted-foreground">Status</th>
                        <th className="px-3 py-2 text-left font-medium text-muted-foreground">Updated</th>
                        <th className="px-3 py-2 text-right font-medium text-muted-foreground">Controls</th>
                    </tr>
                </thead>
                <tbody className="divide-y divide-border">
                    {runs.map((run) => {
                        const stale = run.status === 'running' && (Date.now() - new Date(run.updated_at).getTime()) > STALE_MS
                        const expanded = expandedId === run.id
                        const canPause = PAUSABLE.includes(run.surface)
                        const canCancel = CANCELLABLE.includes(run.surface) && (run.status === 'running' || run.status === 'paused')
                        const busy = busyId === run.id
                        return (
                            <Fragment key={run.id}>
                                <tr
                                    onClick={() => toggleExpand(run.id)}
                                    className="cursor-pointer hover:bg-muted/20 transition-colors"
                                >
                                    <td className="px-3 py-2.5 text-muted-foreground">{expanded ? '▾' : '▸'}</td>
                                    <td className="px-3 py-2.5">
                                        <div className="flex flex-col">
                                            <span className="font-medium">{run.label ?? run.mint_address ?? 'Untitled run'}</span>
                                            {run.mint_address && run.label && (
                                                <span className="font-mono text-[10px] text-muted-foreground">{run.mint_address}</span>
                                            )}
                                        </div>
                                    </td>
                                    <td className="px-3 py-2.5 text-muted-foreground">{SURFACE_LABEL[run.surface]}</td>
                                    <td className="px-3 py-2.5 text-right tabular-nums text-muted-foreground">{run.total_steps ?? '—'}</td>
                                    <td className="px-3 py-2.5">
                                        <span className="inline-flex items-center gap-1.5">
                                            <span className={`size-2 rounded-full ${statusColor(run.status)}`} />
                                            <span className="capitalize">{run.status}</span>
                                            {stale && (
                                                <span className="ml-1 rounded bg-destructive/10 px-1.5 py-0.5 text-[10px] text-destructive">
                                                    stalled — likely lost its tab
                                                </span>
                                            )}
                                        </span>
                                    </td>
                                    <td className="px-3 py-2.5 text-muted-foreground">{relativeAge(run.updated_at)}</td>
                                    <td className="px-3 py-2.5 text-right" onClick={(e) => e.stopPropagation()}>
                                        <div className="flex items-center justify-end gap-1.5">
                                            {stale ? (
                                                <button
                                                    type="button"
                                                    disabled={busy}
                                                    onClick={() => markStopped(run.id)}
                                                    title="Bookkeeping only — this doesn't stop anything still running, the tab is already gone"
                                                    className="px-2 py-1 rounded border border-border text-[10px] text-muted-foreground hover:text-foreground transition-colors disabled:opacity-40"
                                                >
                                                    Mark as stopped
                                                </button>
                                            ) : (
                                                <>
                                                    {canPause && run.status === 'running' && (
                                                        <button
                                                            type="button"
                                                            disabled={busy}
                                                            onClick={() => sendControl(run.id, 'pause_requested')}
                                                            className="px-2 py-1 rounded border border-amber-500/60 bg-amber-500/10 text-[10px] text-amber-500 hover:bg-amber-500/20 transition-colors disabled:opacity-40"
                                                        >
                                                            Pause
                                                        </button>
                                                    )}
                                                    {canPause && run.status === 'paused' && (
                                                        <button
                                                            type="button"
                                                            disabled={busy}
                                                            onClick={() => sendControl(run.id, 'resume_requested')}
                                                            className="px-2 py-1 rounded border border-blue-500/60 bg-blue-500/10 text-[10px] text-blue-500 hover:bg-blue-500/20 transition-colors disabled:opacity-40"
                                                        >
                                                            Resume
                                                        </button>
                                                    )}
                                                    {canCancel && (
                                                        <button
                                                            type="button"
                                                            disabled={busy}
                                                            onClick={() => sendControl(run.id, 'cancel_requested')}
                                                            className="px-2 py-1 rounded border border-destructive/60 bg-destructive/10 text-[10px] text-destructive hover:bg-destructive/20 transition-colors disabled:opacity-40"
                                                        >
                                                            Cancel
                                                        </button>
                                                    )}
                                                    {!canPause && !canCancel && (
                                                        <span className="text-[10px] text-muted-foreground">read-only</span>
                                                    )}
                                                </>
                                            )}
                                        </div>
                                    </td>
                                </tr>
                                {expanded && (
                                    <tr>
                                        <td colSpan={7} className="bg-muted/10 px-4 py-3">
                                            {stepsLoading && steps.length === 0 && (
                                                <p className="text-[11px] text-muted-foreground">Loading steps…</p>
                                            )}
                                            {!stepsLoading && steps.length === 0 && (
                                                <p className="text-[11px] text-muted-foreground">No steps recorded yet.</p>
                                            )}
                                            {steps.length > 0 && (
                                                <div className="flex flex-col divide-y divide-border rounded border border-border overflow-hidden">
                                                    {steps.map((s) => (
                                                        <div key={s.id} className="flex items-center gap-3 px-3 py-1.5 text-[11px]">
                                                            <span className="w-40 shrink-0 truncate font-mono text-muted-foreground">{s.step_key}</span>
                                                            <span className={`w-16 shrink-0 font-medium ${stepStatusColor(s.status)}`}>{s.status}</span>
                                                            {s.amount && <span className="w-24 shrink-0 tabular-nums text-muted-foreground">{s.amount}</span>}
                                                            {s.signature && (
                                                                <span className="flex-1 truncate font-mono text-muted-foreground" title={s.signature}>{s.signature}</span>
                                                            )}
                                                            {s.error && (
                                                                <span className="flex-1 truncate text-destructive" title={s.error}>{s.error}</span>
                                                            )}
                                                        </div>
                                                    ))}
                                                </div>
                                            )}
                                        </td>
                                    </tr>
                                )}
                            </Fragment>
                        )
                    })}
                </tbody>
            </table>
        </div>
    )
}
