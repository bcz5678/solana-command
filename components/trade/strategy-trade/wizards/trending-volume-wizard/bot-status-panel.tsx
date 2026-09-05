'use client'

import { Button } from '@/components/ui/button'

type WalletState = 'IDLE' | 'TRADING'

export interface BotStatusResponse {
    running:        boolean
    paused:         boolean
    shuttingDown:   boolean
    roundIndex:     number | null
    landedRounds:   number | null
    failedRounds:   number | null
    volumeLamports: string | null
    walletPool:     {
        id:              string
        state:           WalletState
        roundsCompleted: number
        roundsFailed:    number
        lastError:       string | null
    }[] | null
}

const STATE_STYLE: Record<WalletState, string> = {
    IDLE:    'text-muted-foreground',
    TRADING: 'text-blue-500',
}

const STATE_DOT: Record<WalletState, string> = {
    IDLE:    'bg-muted-foreground/40',
    TRADING: 'bg-blue-500',
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
    const volumeSol    = status?.volumeLamports ? Number(status.volumeLamports) / 1_000_000_000 : 0

    const counts = pool.reduce<Partial<Record<WalletState, number>>>((acc, w) => {
        acc[w.state] = (acc[w.state] ?? 0) + 1
        return acc
    }, {})

    return (
        <div className="flex flex-col gap-4">

            <div className="flex items-center justify-between gap-4 flex-wrap">
                <div className="flex items-center gap-2.5">
                    <span className={`inline-block size-2 rounded-full ${running ? 'bg-emerald-500 animate-pulse' : 'bg-muted-foreground/30'}`} />
                    <span className="text-sm font-medium">
                        {shuttingDown ? 'Consolidating…' : running ? 'Running' : paused ? 'Paused' : 'Stopped'}
                    </span>
                    {status?.roundIndex != null && (
                        <span className="text-xs text-muted-foreground">round {status.roundIndex.toLocaleString()}</span>
                    )}
                </div>

                <div className="flex items-center gap-2">
                    {running ? (
                        <>
                            <Button size="sm" variant="outline" onClick={onStop} disabled={isLoading || shuttingDown}>
                                Pause Loop
                            </Button>
                            <Button size="sm" variant="destructive" onClick={onShutdown} disabled={isLoading || shuttingDown}>
                                {shuttingDown ? (
                                    <>
                                        <span className="mr-1.5 inline-block size-3 rounded-full border-2 border-white/30 border-t-white animate-spin" />
                                        Consolidating…
                                    </>
                                ) : 'Shutdown'}
                            </Button>
                        </>
                    ) : paused ? (
                        <>
                            <Button size="sm" onClick={onResume} disabled={isLoading}>
                                {isLoading && (
                                    <span className="mr-1.5 inline-block size-3 rounded-full border-2 border-white/30 border-t-white animate-spin" />
                                )}
                                Resume Bot
                            </Button>
                            <Button size="sm" variant="destructive" onClick={onShutdown} disabled={isLoading || shuttingDown}>
                                {shuttingDown ? (
                                    <>
                                        <span className="mr-1.5 inline-block size-3 rounded-full border-2 border-white/30 border-t-white animate-spin" />
                                        Consolidating…
                                    </>
                                ) : 'Shutdown'}
                            </Button>
                        </>
                    ) : (
                        <Button size="sm" onClick={onStart} disabled={!canStart || isLoading}>
                            {isLoading && (
                                <span className="mr-1.5 inline-block size-3 rounded-full border-2 border-white/30 border-t-white animate-spin" />
                            )}
                            Start Bot
                        </Button>
                    )}
                </div>
            </div>

            {(status?.landedRounds != null) && (
                <div className="flex items-center gap-4 flex-wrap text-xs">
                    <span className="text-emerald-500">landed {status.landedRounds}</span>
                    {(status.failedRounds ?? 0) > 0 && <span className="text-destructive">failed {status.failedRounds}</span>}
                    <span className="text-muted-foreground">≈{volumeSol.toFixed(4)} SOL volume</span>
                </div>
            )}

            {pool.length > 0 && (
                <div className="flex items-center gap-4 flex-wrap">
                    {(Object.entries(counts) as [WalletState, number][]).map(([state, n]) => (
                        <span key={state} className={`flex items-center gap-1.5 text-xs ${STATE_STYLE[state]}`}>
                            <span className={`inline-block size-1.5 rounded-full ${STATE_DOT[state]}`} />
                            {state} {n}
                        </span>
                    ))}
                </div>
            )}

            {pool.length > 0 && (
                <div className="rounded-lg border border-border overflow-hidden text-xs">
                    <table className="w-full">
                        <thead>
                            <tr className="border-b border-border bg-muted/30">
                                {['Wallet', 'State', 'Rounds', 'Failed', 'Last Error'].map(h => (
                                    <th
                                        key={h}
                                        className={`px-3 py-2 font-medium text-muted-foreground ${h === 'Wallet' || h === 'Last Error' ? 'text-left' : 'text-right'}`}
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
                                        {w.roundsCompleted}
                                    </td>
                                    <td className="px-3 py-1.5 text-right tabular-nums text-muted-foreground">
                                        {w.roundsFailed}
                                    </td>
                                    <td className="px-3 py-1.5 truncate max-w-48 text-muted-foreground" title={w.lastError ?? undefined}>
                                        {w.lastError ?? '—'}
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
