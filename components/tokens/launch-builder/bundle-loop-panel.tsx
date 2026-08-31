'use client'

import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Minus, ChevronUp, X } from 'lucide-react'

export type BundleLoopRowStatus = 'pending' | 'running' | 'landed' | 'failed'

export type BundleLoopRow = {
    wallets:   { label: string | null; publicKey: string }[]
    amountSol: number
    status:    BundleLoopRowStatus
    bundleId?: string
    error?:    string
}

export type BundleLoopState = {
    nodeId:      string
    rows:        BundleLoopRow[]
    /** Index of the row currently paused awaiting Retry/Skip, or null while running/done. */
    pausedIndex: number | null
    done:        boolean
}

function maskPubKey(key: string) {
    return `${key.slice(0, 5)}…${key.slice(-5)}`
}

function StatusIcon({ status }: { status: BundleLoopRowStatus }) {
    if (status === 'pending') return <span className="size-2 rounded-full bg-muted-foreground/30" />
    if (status === 'running') return <span className="size-3.5 animate-spin rounded-full border-2 border-blue-500 border-t-transparent" />
    if (status === 'landed') {
        return (
            <svg className="size-4 text-green-500" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
            </svg>
        )
    }
    return (
        <svg className="size-4 text-destructive" viewBox="0 0 20 20" fill="currentColor">
            <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
        </svg>
    )
}

type Props = {
    state:   BundleLoopState | null
    onRetry: () => void
    onSkip:  () => void
    onClose: () => void
}

/**
 * Floating, non-modal progress panel for the Bundled Jito loop — deliberately
 * NOT the shared Dialog component, which always renders a blocking overlay.
 * Docked to a corner instead of centered/modal so the canvas stays fully
 * interactive (other nodes, panning, config dialogs) while a loop runs.
 */
export default function BundleLoopPanel({ state, onRetry, onSkip, onClose }: Props) {
    const [minimized, setMinimized] = useState(false)

    // Auto-expand whenever a new run starts, even if a previous run was left minimized.
    useEffect(() => {
        if (state) setMinimized(false)
    }, [state?.nodeId])

    if (!state) return null

    const landedCount = state.rows.filter((r) => r.status === 'landed').length
    const failedCount = state.rows.filter((r) => r.status === 'failed').length
    const summary = `${landedCount}/${state.rows.length} bundle${state.rows.length !== 1 ? 's' : ''} landed${failedCount > 0 ? `, ${failedCount} failed` : ''}`

    if (minimized) {
        return (
            <button
                onClick={() => setMinimized(false)}
                className="fixed bottom-4 right-4 z-40 flex items-center gap-2 rounded-full border border-border bg-popover px-4 py-2 text-xs font-medium text-popover-foreground shadow-lg ring-1 ring-foreground/10 transition-colors hover:bg-muted"
            >
                {!state.done && <span className="size-2 shrink-0 animate-pulse rounded-full bg-blue-500" />}
                Bundled Jito Loop — {summary}
                <ChevronUp className="size-3.5 shrink-0" />
            </button>
        )
    }

    return (
        <div className="fixed bottom-4 right-4 z-40 flex max-h-[70vh] w-96 flex-col overflow-hidden rounded-xl border border-border bg-popover text-popover-foreground shadow-2xl ring-1 ring-foreground/10">
            <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-3">
                <div className="min-w-0">
                    <p className="text-sm font-medium">
                        {state.done ? 'Bundled Jito Loop Complete' : 'Bundled Jito Loop Running…'}
                    </p>
                    <p className="text-xs text-muted-foreground">{summary}</p>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                    <Button variant="ghost" size="icon-sm" onClick={() => setMinimized(true)} title="Minimize">
                        <Minus className="size-4" />
                    </Button>
                    {state.done && (
                        <Button variant="ghost" size="icon-sm" onClick={onClose} title="Close">
                            <X className="size-4" />
                        </Button>
                    )}
                </div>
            </div>

            <div className="flex flex-col divide-y divide-border overflow-y-auto">
                {state.rows.map((row, i) => (
                    <div key={i} className="flex flex-col gap-2 px-4 py-3">
                        <div className="flex items-center gap-3">
                            <div className="flex size-5 shrink-0 items-center justify-center">
                                <StatusIcon status={row.status} />
                            </div>
                            <div className="min-w-0 flex-1">
                                <p className="text-xs font-medium text-foreground">
                                    Bundle {i + 1} · {row.wallets.length} wallet{row.wallets.length !== 1 ? 's' : ''}
                                </p>
                                <p className="truncate text-[11px] font-mono text-muted-foreground">
                                    {row.wallets.map((w) => w.label ?? maskPubKey(w.publicKey)).join(', ')}
                                </p>
                                {row.status === 'landed' && row.bundleId && (
                                    <a
                                        href={`https://explorer.jito.wtf/bundle/${row.bundleId}`}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="text-[10px] text-blue-500 hover:underline"
                                    >
                                        {row.bundleId.slice(0, 8)}… ↗
                                    </a>
                                )}
                                {row.status === 'failed' && row.error && (
                                    <p className="text-[10px] text-destructive">{row.error}</p>
                                )}
                            </div>
                            <span className="shrink-0 text-xs font-semibold tabular-nums">
                                {row.amountSol.toFixed(4)} SOL
                            </span>
                        </div>

                        {state.pausedIndex === i && (
                            <div className="flex items-center gap-2 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2">
                                <p className="flex-1 text-[11px] text-destructive">
                                    Didn&apos;t land — refire, or skip and continue.
                                </p>
                                <Button size="sm" variant="outline" className="h-7 px-2 text-xs" onClick={onSkip}>
                                    Skip
                                </Button>
                                <Button size="sm" className="h-7 px-2 text-xs" onClick={onRetry}>
                                    Retry
                                </Button>
                            </div>
                        )}
                    </div>
                ))}
            </div>
        </div>
    )
}
