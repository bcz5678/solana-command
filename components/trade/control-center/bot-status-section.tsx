'use client'

// Human Volume and Trending Volume are architecturally different from the
// staggered/bundle/launch-builder runs tracked in trade-run-table.tsx: each
// is a single server-side singleton bot (app/api/auto/human, .../trending)
// that keeps cycling independent of any browser tab — closing the tab that
// started one does NOT stop it, unlike the client-driven surfaces this
// Control Center was originally built for. So there's no "lost tab" problem
// to solve here, and no new trade_runs schema involved — this panel is a
// thin read/control surface directly over each bot's own existing GET
// (status) / PATCH (resume) / DELETE (stop | shutdown) endpoints, reusing
// the exact status shape each wizard already defines.

import { useEffect, useState } from 'react'
import type { BotStatusResponse as HumanBotStatus } from '@/components/trade/strategy-trade/wizards/human-volume-wizard/bot-status-panel'
import type { BotStatusResponse as TrendingBotStatus } from '@/components/trade/strategy-trade/wizards/trending-volume-wizard/bot-status-panel'

const POLL_MS = 5_000

function phaseOf(status: { running: boolean; paused: boolean; shuttingDown: boolean } | null): 'stopped' | 'running' | 'paused' | 'draining' {
    if (!status) return 'stopped'
    if (status.shuttingDown) return 'draining'
    if (status.running) return 'running'
    if (status.paused) return 'paused'
    return 'stopped'
}

function phaseDot(phase: ReturnType<typeof phaseOf>): string {
    if (phase === 'running')  return 'bg-emerald-500 animate-pulse'
    if (phase === 'paused')   return 'bg-amber-500'
    if (phase === 'draining') return 'bg-orange-500 animate-pulse'
    return 'bg-muted-foreground/30'
}

function phaseLabel(phase: ReturnType<typeof phaseOf>): string {
    if (phase === 'running')  return 'Running'
    if (phase === 'paused')   return 'Paused'
    if (phase === 'draining') return 'Draining positions…'
    return 'Stopped'
}

interface BotCardProps<T extends { running: boolean; paused: boolean; shuttingDown: boolean }> {
    title:        string
    wizardHref:   string
    basePath:     string   // e.g. '/api/auto/human'
    status:       T | null
    summary:      (status: T) => string
    renderPool:   (status: T) => React.ReactNode
    onChanged:    () => void
}

function BotCard<T extends { running: boolean; paused: boolean; shuttingDown: boolean }>({
    title, wizardHref, basePath, status, summary, renderPool, onChanged,
}: BotCardProps<T>) {
    const [busy, setBusy] = useState(false)
    const phase = phaseOf(status)

    async function act(input: RequestInfo, init: RequestInit) {
        setBusy(true)
        try {
            await fetch(input, init)
            onChanged()
        } finally {
            setBusy(false)
        }
    }

    if (phase === 'stopped') {
        return (
            <div className="rounded-lg border border-border px-4 py-3 flex items-center justify-between">
                <div className="flex items-center gap-2.5 text-sm">
                    <span className="inline-block size-2 rounded-full bg-muted-foreground/30" />
                    <span className="font-medium">{title}</span>
                    <span className="text-xs text-muted-foreground">not running</span>
                </div>
                <a href={wizardHref} className="text-[11px] text-muted-foreground hover:text-foreground transition-colors">
                    Start from Strategy Trade →
                </a>
            </div>
        )
    }

    return (
        <div className="rounded-lg border border-border px-4 py-3 flex flex-col gap-3">
            <div className="flex items-center justify-between gap-4 flex-wrap">
                <div className="flex items-center gap-2.5 text-sm">
                    <span className={`inline-block size-2 rounded-full ${phaseDot(phase)}`} />
                    <span className="font-medium">{title}</span>
                    <span className="text-xs text-muted-foreground">{phaseLabel(phase)}</span>
                    {status && <span className="text-xs text-muted-foreground">— {summary(status)}</span>}
                </div>
                <div className="flex items-center gap-1.5">
                    {phase === 'running' && (
                        <button
                            type="button"
                            disabled={busy}
                            onClick={() => act(`${basePath}?action=stop`, { method: 'DELETE' })}
                            className="px-2 py-1 rounded border border-amber-500/60 bg-amber-500/10 text-[10px] text-amber-500 hover:bg-amber-500/20 transition-colors disabled:opacity-40"
                        >
                            Pause
                        </button>
                    )}
                    {phase === 'paused' && (
                        <button
                            type="button"
                            disabled={busy}
                            onClick={() => act(basePath, { method: 'PATCH' })}
                            className="px-2 py-1 rounded border border-blue-500/60 bg-blue-500/10 text-[10px] text-blue-500 hover:bg-blue-500/20 transition-colors disabled:opacity-40"
                        >
                            Resume
                        </button>
                    )}
                    {(phase === 'running' || phase === 'paused') && (
                        <button
                            type="button"
                            disabled={busy}
                            onClick={() => act(basePath, { method: 'DELETE' })}
                            className="px-2 py-1 rounded border border-destructive/60 bg-destructive/10 text-[10px] text-destructive hover:bg-destructive/20 transition-colors disabled:opacity-40"
                        >
                            Shutdown
                        </button>
                    )}
                </div>
            </div>
            {status && renderPool(status)}
        </div>
    )
}

export default function BotStatusSection() {
    const [human, setHuman]       = useState<HumanBotStatus | null>(null)
    const [trending, setTrending] = useState<TrendingBotStatus | null>(null)

    async function refresh() {
        const [h, t] = await Promise.all([
            fetch('/api/auto/human').then((r) => (r.ok ? r.json() : null)).catch(() => null),
            fetch('/api/auto/trending').then((r) => (r.ok ? r.json() : null)).catch(() => null),
        ])
        if (h) setHuman(h as HumanBotStatus)
        if (t) setTrending(t as TrendingBotStatus)
    }

    useEffect(() => {
        refresh()
        const id = setInterval(refresh, POLL_MS)
        return () => clearInterval(id)
    }, [])

    return (
        <div className="flex flex-col gap-3">
            <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                Active Bots — Human Volume / Trending Volume
            </span>
            <p className="text-[11px] text-muted-foreground -mt-1">
                These run as a persistent server-side process, not a browser loop — they keep going even if every tab is
                closed. Pause/Resume/Shutdown here act on the same live bot the wizard controls.
            </p>
            <BotCard
                title="Human Volume"
                wizardHref="/protected/trade/strategy-trade"
                basePath="/api/auto/human"
                status={human}
                summary={(s) => `cycle ${s.cycleIndex ?? 0}${s.walletPool ? `, ${s.walletPool.length} wallets` : ''}`}
                renderPool={(s) => (
                    (s.walletPool?.length ?? 0) > 0 && (
                        <div className="flex flex-wrap gap-3 text-[11px] text-muted-foreground">
                            {Object.entries(
                                (s.walletPool ?? []).reduce<Record<string, number>>((acc, w) => {
                                    acc[w.state] = (acc[w.state] ?? 0) + 1
                                    return acc
                                }, {}),
                            ).map(([state, n]) => (
                                <span key={state}>{state.replace('_', ' ')} {n}</span>
                            ))}
                        </div>
                    )
                )}
                onChanged={refresh}
            />
            <BotCard
                title="Trending Volume"
                wizardHref="/protected/trade/strategy-trade"
                basePath="/api/auto/trending"
                status={trending}
                summary={(s) => `round ${s.roundIndex ?? 0}${s.walletPool ? `, ${s.walletPool.length} wallets` : ''}`}
                renderPool={(s) => (
                    (s.walletPool?.length ?? 0) > 0 && (
                        <div className="flex flex-wrap gap-3 text-[11px] text-muted-foreground">
                            {Object.entries(
                                (s.walletPool ?? []).reduce<Record<string, number>>((acc, w) => {
                                    acc[w.state] = (acc[w.state] ?? 0) + 1
                                    return acc
                                }, {}),
                            ).map(([state, n]) => (
                                <span key={state}>{state} {n}</span>
                            ))}
                        </div>
                    )
                )}
                onChanged={refresh}
            />
        </div>
    )
}
