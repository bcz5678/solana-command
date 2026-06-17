'use client'

import { Button } from '@/components/ui/button'

type WalletState = 'IDLE' | 'BUYING' | 'HOLDING' | 'HOLDING_PORTION' | 'SELLING'

export interface BotStatusResponse {
    running:      boolean
    paused:       boolean
    shuttingDown: boolean
    cycleIndex:   number | null
    walletPool:   {
        id:              string
        state:           WalletState
        holdCycles:      number | null
        sellTranches:    number
        tokenBalanceRaw: string
        lamportsSpent:   string
        boughtAtCycle:   number | null
    }[] | null
}

const STATE_STYLE: Record<WalletState, string> = {
    IDLE:            'text-muted-foreground',
    BUYING:          'text-blue-500',
    HOLDING:         'text-emerald-500',
    HOLDING_PORTION: 'text-amber-500',
    SELLING:         'text-orange-500',
}

const STATE_DOT: Record<WalletState, string> = {
    IDLE:            'bg-muted-foreground/40',
    BUYING:          'bg-blue-500',
    HOLDING:         'bg-emerald-500',
    HOLDING_PORTION: 'bg-amber-500',
    SELLING:         'bg-orange-500',
}

type Props = {
    status:     BotStatusResponse | null
    isLoading:  boolean
    canStart:   boolean
    onStart:    () => void
    onResume:   () => void
    onShutdown: () => void
    onStop:     () => void
}

export default function BotStatusPanel({ status, isLoading, canStart, onStart, onResume, onShutdown, onStop }: Props) {
    const running      = status?.running      ?? false
    const paused       = status?.paused       ?? false
    const shuttingDown = status?.shuttingDown ?? false
    const pool         = status?.walletPool   ?? []

    const counts = pool.reduce<Partial<Record<WalletState, number>>>((acc, w) => {
        acc[w.state] = (acc[w.state] ?? 0) + 1
        return acc
    }, {})

    return (
        <div className="flex flex-col gap-4">

            {/* Top bar: status indicator + action buttons */}
            <div className="flex items-center justify-between gap-4 flex-wrap">
                <div className="flex items-center gap-2.5">
                    <span className={`inline-block size-2 rounded-full ${running ? 'bg-emerald-500 animate-pulse' : 'bg-muted-foreground/30'}`} />
                    <span className="text-sm font-medium">
                        {shuttingDown ? 'Draining positions…' : running ? 'Running' : paused ? 'Paused' : 'Stopped'}
                    </span>
                    {status?.cycleIndex != null && (
                        <span className="text-xs text-muted-foreground">cycle {status.cycleIndex.toLocaleString()}</span>
                    )}
                </div>

                <div className="flex items-center gap-2">
                    {running ? (
                        <>
                            <Button
                                size="sm"
                                variant="outline"
                                onClick={onStop}
                                disabled={isLoading || shuttingDown}
                            >
                                Pause Loop
                            </Button>
                            <Button
                                size="sm"
                                variant="destructive"
                                onClick={onShutdown}
                                disabled={isLoading || shuttingDown}
                            >
                                {shuttingDown ? (
                                    <>
                                        <span className="mr-1.5 inline-block size-3 rounded-full border-2 border-white/30 border-t-white animate-spin" />
                                        Draining…
                                    </>
                                ) : 'Shutdown'}
                            </Button>
                        </>
                    ) : paused ? (
                        <>
                            <Button
                                size="sm"
                                onClick={onResume}
                                disabled={isLoading}
                            >
                                {isLoading && (
                                    <span className="mr-1.5 inline-block size-3 rounded-full border-2 border-white/30 border-t-white animate-spin" />
                                )}
                                Resume Bot
                            </Button>
                            <Button
                                size="sm"
                                variant="destructive"
                                onClick={onShutdown}
                                disabled={isLoading || shuttingDown}
                            >
                                {shuttingDown ? (
                                    <>
                                        <span className="mr-1.5 inline-block size-3 rounded-full border-2 border-white/30 border-t-white animate-spin" />
                                        Draining…
                                    </>
                                ) : 'Shutdown'}
                            </Button>
                        </>
                    ) : (
                        <Button
                            size="sm"
                            onClick={onStart}
                            disabled={!canStart || isLoading}
                        >
                            {isLoading && (
                                <span className="mr-1.5 inline-block size-3 rounded-full border-2 border-white/30 border-t-white animate-spin" />
                            )}
                            Start Bot
                        </Button>
                    )}
                </div>
            </div>

            {/* State tally */}
            {pool.length > 0 && (
                <div className="flex items-center gap-4 flex-wrap">
                    {(Object.entries(counts) as [WalletState, number][]).map(([state, n]) => (
                        <span key={state} className={`flex items-center gap-1.5 text-xs ${STATE_STYLE[state]}`}>
                            <span className={`inline-block size-1.5 rounded-full ${STATE_DOT[state]}`} />
                            {state.replace('_', ' ')} {n}
                        </span>
                    ))}
                </div>
            )}

            {/* Wallet pool table */}
            {pool.length > 0 && (
                <div className="rounded-lg border border-border overflow-hidden text-xs">
                    <table className="w-full">
                        <thead>
                            <tr className="border-b border-border bg-muted/30">
                                {['Wallet', 'State', 'Hold', 'Tranche', 'Cycle'].map(h => (
                                    <th
                                        key={h}
                                        className={`px-3 py-2 font-medium text-muted-foreground ${h === 'Wallet' ? 'text-left' : 'text-right'}`}
                                    >
                                        {h}
                                    </th>
                                ))}
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-border">
                            {pool.map((w, i) => (
                                <tr key={w.id} className={i % 2 !== 0 ? 'bg-muted/10' : ''}>
                                    <td className="px-3 py-1.5 font-mono text-muted-foreground">{w.id}</td>
                                    <td className={`px-3 py-1.5 text-right font-medium ${STATE_STYLE[w.state]}`}>
                                        {w.state}
                                    </td>
                                    <td className="px-3 py-1.5 text-right tabular-nums text-muted-foreground">
                                        {w.holdCycles ?? '—'}
                                    </td>
                                    <td className="px-3 py-1.5 text-right tabular-nums text-muted-foreground">
                                        {w.sellTranches}
                                    </td>
                                    <td className="px-3 py-1.5 text-right tabular-nums text-muted-foreground">
                                        {w.boughtAtCycle ?? '—'}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}

            {!running && pool.length === 0 && (
                <p className="text-xs text-muted-foreground text-center py-4">
                    Configure the bot below and press <span className="font-medium text-foreground">Start Bot</span> to begin.
                </p>
            )}
        </div>
    )
}
