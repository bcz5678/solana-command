'use client'

import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Minus, ChevronUp, X, ExternalLink } from 'lucide-react'
import { useRelayEvent, useRelayStatus } from '@/hooks/use-relay-event'
import type { TokenTransactionEvent } from '@/lib/wss/types'

const MAX_TRADES = 200

function maskKey(key: string) {
    return `${key.slice(0, 5)}…${key.slice(-5)}`
}

function timeAgo(unixSeconds: number) {
    const s = Math.max(0, Math.floor(Date.now() / 1000 - unixSeconds))
    if (s < 60) return `${s}s ago`
    if (s < 3600) return `${Math.floor(s / 60)}m ago`
    return `${Math.floor(s / 3600)}h ago`
}

function TxTypeBadge({ txType }: { txType: TokenTransactionEvent['txType'] }) {
    if (txType === 'buy') {
        return <span className="rounded px-1.5 py-0.5 text-[10px] font-semibold bg-green-500/15 text-green-500">BUY</span>
    }
    if (txType === 'sell') {
        return <span className="rounded px-1.5 py-0.5 text-[10px] font-semibold bg-red-500/15 text-red-500">SELL</span>
    }
    return <span className="rounded px-1.5 py-0.5 text-[10px] font-semibold bg-muted text-muted-foreground">{txType.toUpperCase()}</span>
}

type Props = {
    mintAddress: string
    tokenSymbol?: string | null
    /** Base58 public keys of wallets we control — matching trades are visually flagged. */
    ourWallets?: Set<string>
    /** public_key -> label, for showing a friendly name instead of the masked address on a match. */
    ourWalletLabels?: Record<string, string>
    /** Tailwind position classes (e.g. 'bottom-4 right-4'). Override when another
     *  fixed panel (e.g. the Launch Builder's BundleLoopPanel) shares the same corner. */
    positionClassName?: string
}

/**
 * Floating, non-modal live trade feed for a just-launched token — deliberately
 * not the shared Dialog component so the rest of the wizard stays interactive.
 * Modeled on components/tokens/launch-builder/bundle-loop-panel.tsx (fixed
 * position, minimize-to-pill, scrollable list).
 *
 * Sourced from websocket-server's per-mint bonding-curve watch via lib/wss —
 * every trade on the mint, not just ones this platform executed, delivered in
 * the order they land on-chain (see lib/wss/API.md).
 */
export default function LaunchTradeFeedPanel({ mintAddress, tokenSymbol, ourWallets, ourWalletLabels, positionClassName = 'bottom-4 right-4' }: Props) {
    const [trades, setTrades] = useState<TokenTransactionEvent[]>([])
    const [minimized, setMinimized] = useState(false)
    const [closed, setClosed] = useState(false)
    const relayStatus = useRelayStatus()

    useEffect(() => {
        setTrades([])
        fetch('/api/wss/tokens/watch', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ mint: mintAddress }),
        }).catch(() => {})

        return () => {
            fetch('/api/wss/tokens/unwatch', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ mint: mintAddress }),
            }).catch(() => {})
        }
    }, [mintAddress])

    useRelayEvent('token-transaction', (e) => {
        if (e.mint !== mintAddress) return
        setTrades((prev) => {
            // Sort by slot/blockTime rather than trusting arrival order — the relay's
            // tx-parse queue is rate-limited (see websocket-server drainTxQueue), so
            // under bursty trading a later-landing trade's getTransaction fetch can
            // resolve and get emitted before an earlier one finishes. A dedupe guard
            // also covers the SSE reconnect backfill re-sending an already-seen trade.
            if (prev.some((t) => t.signature === e.signature)) return prev
            return [...prev, e]
                .sort((a, b) => b.slot - a.slot || b.timestamp - a.timestamp)
                .slice(0, MAX_TRADES)
        })
    })

    if (closed) return null

    const statusColor = relayStatus === 'open' ? 'bg-green-500' : relayStatus === 'connecting' ? 'bg-amber-500' : 'bg-destructive'
    const statusLabel = relayStatus === 'open' ? 'Live' : relayStatus === 'connecting' ? 'Connecting…' : 'Disconnected'

    if (minimized) {
        return (
            <button
                onClick={() => setMinimized(false)}
                className={`fixed ${positionClassName} z-40 flex items-center gap-2 rounded-full border border-border bg-popover px-4 py-2 text-xs font-medium text-popover-foreground shadow-lg ring-1 ring-foreground/10 transition-colors hover:bg-muted`}
            >
                <span className={['size-2 shrink-0 rounded-full', statusColor, relayStatus !== 'closed' ? 'animate-pulse' : ''].join(' ')} />
                Trade Feed — {trades.length} trade{trades.length !== 1 ? 's' : ''}
                <ChevronUp className="size-3.5 shrink-0" />
            </button>
        )
    }

    return (
        <div className={`fixed ${positionClassName} z-40 flex max-h-[70vh] w-96 flex-col overflow-hidden rounded-xl border border-border bg-popover text-popover-foreground shadow-2xl ring-1 ring-foreground/10`}>
            <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-3">
                <div className="min-w-0">
                    <p className="flex items-center gap-1.5 text-sm font-medium">
                        <span className={['size-2 shrink-0 rounded-full', statusColor, relayStatus !== 'closed' ? 'animate-pulse' : ''].join(' ')} />
                        Trade Feed{tokenSymbol ? ` · ${tokenSymbol}` : ''}
                    </p>
                    <p className="text-xs text-muted-foreground">
                        {statusLabel} — {trades.length} trade{trades.length !== 1 ? 's' : ''}
                    </p>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                    <Button variant="ghost" size="icon-sm" onClick={() => setMinimized(true)} title="Minimize">
                        <Minus className="size-4" />
                    </Button>
                    <Button variant="ghost" size="icon-sm" onClick={() => setClosed(true)} title="Close">
                        <X className="size-4" />
                    </Button>
                </div>
            </div>

            <div className="flex flex-col divide-y divide-border overflow-y-auto">
                {trades.length === 0 && (
                    <p className="px-4 py-6 text-center text-xs text-muted-foreground">
                        Watching for trades — none landed yet.
                    </p>
                )}
                {trades.map((t) => {
                    const isOurs = ourWallets?.has(t.wallet) ?? false
                    const ourLabel = isOurs ? ourWalletLabels?.[t.wallet] : undefined
                    return (
                    <div
                        key={t.signature}
                        className={[
                            'flex items-center gap-2 px-4 py-2.5',
                            isOurs ? 'bg-blue-500/10 border-l-2 border-l-blue-500' : '',
                        ].join(' ')}
                    >
                        <TxTypeBadge txType={t.txType} />
                        <div className="min-w-0 flex-1">
                            <p className="flex items-center gap-1.5 truncate text-xs font-mono text-foreground">
                                {ourLabel ?? maskKey(t.wallet)}
                                {isOurs && (
                                    <span className="shrink-0 rounded px-1 py-0.5 text-[9px] font-semibold bg-blue-500/20 text-blue-500">
                                        OURS
                                    </span>
                                )}
                            </p>
                            <p className="text-[10px] text-muted-foreground">{timeAgo(t.timestamp)}</p>
                        </div>
                        <div className="shrink-0 text-right">
                            <p className="text-xs font-semibold tabular-nums">
                                {Math.abs(t.solAmount).toFixed(4)} SOL
                            </p>
                            {t.marketCapSol != null && (
                                <p className="text-[10px] text-muted-foreground tabular-nums">
                                    MC {t.marketCapSol.toFixed(1)} SOL
                                </p>
                            )}
                        </div>
                        <a
                            href={`https://solscan.io/tx/${t.signature}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex shrink-0 items-center justify-center rounded p-0.5 text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                            aria-label="View on Solscan"
                        >
                            <ExternalLink className="size-3" />
                        </a>
                    </div>
                    )
                })}
            </div>
        </div>
    )
}
