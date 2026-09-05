'use client'

import { useEffect, useState } from 'react'
import type { CommentScheduleEntry } from '@/lib/types/comment-bank'
import type { WalletRecord } from '@/lib/types/wallet'

function maskPubKey(key: string) {
    return `${key.slice(0, 7)}....${key.slice(-7)}`
}

// Comments fire on a durable server-side schedule (private.comment_schedule),
// completely decoupled from this wizard's own execution loop — a buy can
// land now and its comment not post for another half hour. Polling is the
// only way this panel can reflect that; there's no push event for it.
const POLL_MS = 6_000

function relativeTime(iso: string): string {
    const ms = new Date(iso).getTime() - Date.now()
    const abs = Math.abs(ms)
    const label = abs < 60_000 ? `${Math.round(abs / 1000)}s` : abs < 3_600_000 ? `${Math.round(abs / 60_000)}m` : `${Math.round(abs / 3_600_000)}h`
    return ms >= 0 ? `in ${label}` : `${label} ago`
}

function StatusDot({ status }: { status: CommentScheduleEntry['status'] }) {
    if (status === 'pending')    return <span className="size-2 shrink-0 rounded-full bg-muted-foreground/30" />
    if (status === 'processing') return <span className="size-3 shrink-0 animate-spin rounded-full border-2 border-blue-500 border-t-transparent" />
    if (status === 'posted')     return <span className="size-2 shrink-0 rounded-full bg-green-500" />
    if (status === 'failed')     return <span className="size-2 shrink-0 rounded-full bg-destructive" />
    return <span className="size-2 shrink-0 rounded-full bg-muted-foreground/50" /> // skipped
}

interface Props {
    /** Only rows for this mint are shown. */
    mintAddress: string
    /** Further restrict to just these wallets (e.g. this run's own set) — omit to show every schedule row for the mint. */
    walletIds?: Set<string> | string[]
    /** For label/pubkey display — pass the wizard's own already-fetched wallet list to avoid a second fetch. */
    wallets?: WalletRecord[]
    className?: string
}

/**
 * Live-polling feed of auto-comment activity for a token — what's queued,
 * what's about to fire, and (once posted) the exact text that went out.
 * Reusable across any surface with autoComment enabled; currently wired
 * into the Staggered Buy wizard's Execute step.
 */
export default function CommentActivityFeed({ mintAddress, walletIds, wallets = [], className = '' }: Props) {
    const [entries, setEntries] = useState<CommentScheduleEntry[]>([])
    const [loading, setLoading] = useState(true)

    useEffect(() => {
        let cancelled = false
        function refresh() {
            fetch('/api/comment-schedule?limit=200')
                .then((r) => (r.ok ? r.json() : null))
                .then((data) => {
                    if (cancelled || !data) return
                    setEntries((data.entries ?? []) as CommentScheduleEntry[])
                })
                .catch(() => {})
                .finally(() => { if (!cancelled) setLoading(false) })
        }
        refresh()
        const id = setInterval(refresh, POLL_MS)
        return () => { cancelled = true; clearInterval(id) }
    }, [])

    const filterIds = walletIds ? new Set(walletIds) : null
    const rows = entries
        .filter((e) => e.mint_address === mintAddress)
        .filter((e) => !filterIds || filterIds.has(e.wallet_id))
        // Timeline order — soonest-to-fire (or most-recently-fired) first,
        // regardless of the RPC's own scheduled_for DESC default order.
        .sort((a, b) => new Date(a.scheduled_for).getTime() - new Date(b.scheduled_for).getTime())

    return (
        <div className={`flex flex-col gap-2 ${className}`}>
            <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                Comment Activity{rows.length > 0 ? ` (${rows.length})` : ''}
            </span>
            <div className="rounded-lg border border-border overflow-hidden">
                {loading && rows.length === 0 && (
                    <p className="px-3 py-3 text-xs text-muted-foreground">Loading…</p>
                )}
                {!loading && rows.length === 0 && (
                    <p className="px-3 py-3 text-xs text-muted-foreground">
                        No auto-comments scheduled yet — one gets queued right after each wallet&apos;s buy lands.
                    </p>
                )}
                {rows.length > 0 && (
                    <div className="max-h-72 overflow-y-auto divide-y divide-border">
                        {rows.map((e) => {
                            const w = wallets.find((wl) => wl.id === e.wallet_id)
                            const label = w?.label ?? maskPubKey(w?.public_key ?? e.wallet_id)
                            return (
                                <div key={e.id} className="flex flex-col gap-1 px-3 py-2.5">
                                    <div className="flex items-center gap-2">
                                        <StatusDot status={e.status} />
                                        <span className="text-xs font-medium truncate">{label}</span>
                                        <span className="ml-auto shrink-0 text-[10px] text-muted-foreground">
                                            {e.status === 'posted' && e.posted_at
                                                ? `posted ${relativeTime(e.posted_at)}`
                                                : e.status === 'pending' || e.status === 'processing'
                                                    ? `posting ${relativeTime(e.scheduled_for)}`
                                                    : e.status}
                                        </span>
                                    </div>
                                    {e.status === 'posted' && e.comment_text && (
                                        <p className="pl-4 text-xs text-foreground">&ldquo;{e.comment_text}&rdquo;</p>
                                    )}
                                    {e.status === 'failed' && e.last_error && (
                                        <p className="pl-4 text-[10px] text-destructive truncate" title={e.last_error}>{e.last_error}</p>
                                    )}
                                    {e.status === 'skipped' && e.last_error && (
                                        <p className="pl-4 text-[10px] text-muted-foreground truncate" title={e.last_error}>{e.last_error}</p>
                                    )}
                                </div>
                            )
                        })}
                    </div>
                )}
            </div>
        </div>
    )
}
