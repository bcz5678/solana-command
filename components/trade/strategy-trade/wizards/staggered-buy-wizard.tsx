'use client'

import { useState, useMemo, useEffect, useRef } from 'react'
import BN from 'bn.js'
import WizardShell, { WizardStep } from './wizard-shell'
import StrategyWalletSelector from '@/components/trade/strategy-trade/strategy-wallet-selector'
import { solStringToLamports, lamportsBNToSolDisplay, lamportsStringToBN } from '@/lib/lamports'
import { WalletRecord } from '@/lib/types/wallet'
import { SlippageControl } from '@/components/trade/trade/SlippageControl'
import { TokenMintInput } from '@/components/trade/strategy-trade/TokenMintInput'

type TradeType  = 'buy' | 'sell'
type ExecPhase  = 'idle' | 'running' | 'paused' | 'done' | 'cancelled'
type ExecStatus = 'pending' | 'executing' | 'success' | 'error' | 'cancelled'

type ScheduleEntry = {
    walletId:    string
    delayMsAfter: number   // ms to wait after this trade; 0 for last entry
}

type ExecEntry = {
    walletId:   string
    status:     ExecStatus
    signature?: string
    error?:     string
}

const steps: WizardStep[] = [
    {
        label: 'Parameters',
        icon: (
            <svg className="size-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="4" y1="8" x2="20" y2="8" /><line x1="4" y1="16" x2="20" y2="16" />
                <circle cx="9" cy="8" r="2.5" fill="currentColor" stroke="none" />
                <circle cx="15" cy="16" r="2.5" fill="currentColor" stroke="none" />
            </svg>
        ),
    },
    {
        label: 'Schedule',
        icon: (
            <svg className="size-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" />
            </svg>
        ),
    },
    {
        label: 'Review',
        icon: (
            <svg className="size-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M9 11l3 3L22 4" /><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
            </svg>
        ),
    },
    {
        label: 'Execute',
        icon: (
            <svg className="size-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polygon points="5 3 19 12 5 21 5 3" />
            </svg>
        ),
    },
]

function maskPubKey(key: string) {
    return `${key.slice(0, 7)}....${key.slice(-7)}`
}

function randomInRange(min: number, max: number): string {
    return (Math.random() * (max - min) + min).toFixed(2)
}

function rawPctAmount(rawBalance: string, pct: number): string {
    if (!rawBalance || rawBalance === '0' || pct <= 0) return '0'
    const pctScaled = BigInt(Math.round(pct * 1000))
    return (BigInt(rawBalance) * pctScaled / 100_000n).toString()
}

// Countdown that respects pause and abort. Tracks actual elapsed time so
// paused duration is never counted against the remaining wait.
function countdownSleep(
    ms: number,
    onTick: (remaining: number) => void,
    pauseRef: { current: boolean },
    abortRef: { current: boolean },
): Promise<void> {
    let remaining = ms
    let lastTick  = Date.now()
    return new Promise<void>((resolve) => {
        const tick = () => {
            if (abortRef.current) { resolve(); return }
            const now     = Date.now()
            const elapsed = now - lastTick
            lastTick = now
            if (!pauseRef.current) {
                remaining = Math.max(0, remaining - elapsed)
                onTick(remaining)
                if (remaining <= 0) { resolve(); return }
            }
            setTimeout(tick, 100)
        }
        tick()
    })
}

export default function StaggeredBuyWizard() {
    const [step, setStep]                       = useState(0)
    const [tradeType, setTradeType]             = useState<TradeType>('buy')
    const [selectedWallets, setSelectedWallets] = useState<Set<string>>(new Set())
    const [tradeAmounts, setTradeAmounts]       = useState<Record<string, string>>({})
    const [randomRange, setRandomRange]         = useState(false)
    const [rangeMin, setRangeMin]               = useState('')
    const [rangeMax, setRangeMax]               = useState('')
    const [maxSolEnabled, setMaxSolEnabled]     = useState(false)
    const [maxSolTotal, setMaxSolTotal]         = useState('')
    const [slippage, setSlippage]               = useState(0.05)
    const [sellPct, setSellPct]                 = useState('')
    const [delayMin, setDelayMin]               = useState('5')
    const [delayMax, setDelayMax]               = useState('30')
    const [tokenMint, setTokenMint]             = useState('')
    const [tokenResolved, setTokenResolved]     = useState(false)
    const [tokenName, setTokenName]             = useState('')
    const [tokenSymbol, setTokenSymbol]         = useState('')
    const [tokenBalances, setTokenBalances]     = useState<Record<string, string>>({})
    const [tokenDecimals, setTokenDecimals]     = useState(6)
    const [wallets, setWallets]                 = useState<WalletRecord[]>([])
    const [errorWalletIds, setErrorWalletIds]   = useState<Set<string>>(new Set())
    const [nextError, setNextError]             = useState<{ id: string; label: string }[]>([])

    // Schedule (generated once when leaving Parameters step)
    const [schedule, setSchedule] = useState<ScheduleEntry[]>([])

    // Live execution state
    const [execState, setExecState]             = useState<ExecEntry[]>([])
    const [execPhase, setExecPhase]             = useState<ExecPhase>('idle')
    const [execCountdownMs, setExecCountdownMs] = useState<number | null>(null)
    const [execNextWalletId, setExecNextWalletId] = useState<string | null>(null)
    const abortRef = useRef(false)
    const pauseRef = useRef(false)

    useEffect(() => {
        fetch('/api/wallets/explorer')
            .then((r) => r.ok ? r.json() : null)
            .then((data) => {
                if (!data) return
                setWallets((data.wallets ?? []).map((w: any) => ({
                    ...w,
                    solana_balance_in_lamports: w.solana_balance_in_lamports != null
                        ? lamportsStringToBN(String(w.solana_balance_in_lamports))
                        : null,
                })))
            })
            .catch(() => {})
    }, [])

    // Clear amounts when trade type changes
    useEffect(() => {
        setTradeAmounts({})
        setSellPct('')
    }, [tradeType])

    // Clear validation errors when inputs change
    useEffect(() => {
        setNextError([])
        setErrorWalletIds(new Set())
    }, [tradeAmounts, selectedWallets, slippage, tradeType])

    // ── helpers ──────────────────────────────────────────────────────────────

    function validDelayRange(): { minMs: number; maxMs: number } | null {
        const min = parseFloat(delayMin)
        const max = parseFloat(delayMax)
        if (!isNaN(min) && !isNaN(max) && max >= min && min >= 0) return { minMs: min * 1000, maxMs: max * 1000 }
        return null
    }

    function validAmountRange(): { min: number; max: number } | null {
        const min = parseFloat(rangeMin)
        const max = parseFloat(rangeMax)
        if (!isNaN(min) && !isNaN(max) && max >= min && min >= 0) return { min, max }
        return null
    }

    function buildSchedule(): ScheduleEntry[] {
        const delay = validDelayRange() ?? { minMs: 5000, maxMs: 30000 }
        // Shuffle wallet order for human-like randomness
        const shuffled = [...selectedWallets].sort(() => Math.random() - 0.5)
        return shuffled.map((id, i): ScheduleEntry => ({
            walletId:     id,
            delayMsAfter: i < shuffled.length - 1
                ? Math.round(Math.random() * (delay.maxMs - delay.minMs) + delay.minMs)
                : 0,
        }))
    }

    // ── amount helpers ────────────────────────────────────────────────────────

    function applyMaxSolSplit(total: number, ids: Set<string>, base: Record<string, string> = tradeAmounts) {
        if (ids.size === 0) return
        const perWallet = (total / ids.size).toFixed(4)
        const next = { ...base }
        ids.forEach((id) => { next[id] = perWallet })
        setTradeAmounts(next)
    }

    function applyRangeToSelected(min: number, max: number) {
        if (selectedWallets.size === 0) return
        const next = { ...tradeAmounts }
        selectedWallets.forEach((id) => { next[id] = randomInRange(min, max) })
        setTradeAmounts(next)
    }

    function applyPctToWallets(pct: number, ids: Set<string>) {
        if (ids.size === 0 || pct <= 0) return
        const next = { ...tradeAmounts }
        ids.forEach((id) => {
            const raw = tokenBalances[id]
            if (raw && raw !== '0') next[id] = rawPctAmount(raw, pct)
        })
        setTradeAmounts(next)
    }

    function handleMaxSolToggle(enabled: boolean) {
        setMaxSolEnabled(enabled)
        if (enabled && selectedWallets.size > 0) {
            const total = parseFloat(maxSolTotal)
            if (!isNaN(total) && total > 0) applyMaxSolSplit(total, selectedWallets)
        }
    }

    function handleMaxSolChange(value: string) {
        setMaxSolTotal(value)
        if (!maxSolEnabled || selectedWallets.size === 0) return
        const total = parseFloat(value)
        if (!isNaN(total) && total > 0) applyMaxSolSplit(total, selectedWallets)
    }

    function handleRandomRangeToggle(enabled: boolean) {
        setRandomRange(enabled)
        if (enabled && selectedWallets.size > 0) {
            const r = validAmountRange()
            if (r) applyRangeToSelected(r.min, r.max)
        }
    }

    function handleRangeMinChange(value: string) {
        setRangeMin(value)
        if (!randomRange) return
        const min = parseFloat(value), max = parseFloat(rangeMax)
        if (!isNaN(min) && !isNaN(max) && max >= min && min >= 0) applyRangeToSelected(min, max)
    }

    function handleRangeMaxChange(value: string) {
        setRangeMax(value)
        if (!randomRange) return
        const min = parseFloat(rangeMin), max = parseFloat(value)
        if (!isNaN(min) && !isNaN(max) && max >= min && min >= 0) applyRangeToSelected(min, max)
    }

    function handleSellPctChange(value: string) {
        setSellPct(value)
        const pct = parseFloat(value)
        if (!isNaN(pct) && pct > 0) applyPctToWallets(pct, selectedWallets)
    }

    function handleSelectionChange(newIds: Set<string>) {
        const next = { ...tradeAmounts }
        selectedWallets.forEach((id) => { if (!newIds.has(id)) delete next[id] })

        if (maxSolEnabled) {
            const total = parseFloat(maxSolTotal)
            if (!isNaN(total) && total > 0 && newIds.size > 0) {
                const perWallet = (total / newIds.size).toFixed(4)
                newIds.forEach((id) => { next[id] = perWallet })
            }
        } else if (randomRange) {
            const r = validAmountRange()
            if (r) newIds.forEach((id) => { if (!selectedWallets.has(id)) next[id] = randomInRange(r.min, r.max) })
        } else if (tradeType === 'sell' && sellPct) {
            const pct = parseFloat(sellPct)
            if (!isNaN(pct) && pct > 0) {
                newIds.forEach((id) => {
                    if (!selectedWallets.has(id)) {
                        const raw = tokenBalances[id]
                        if (raw && raw !== '0') next[id] = rawPctAmount(raw, pct)
                    }
                })
            }
        }

        setTradeAmounts(next)
        setSelectedWallets(newIds)
    }

    // ── validation & navigation ───────────────────────────────────────────────

    const canProceed = useMemo(() => {
        if (step !== 0) return true
        if (!tokenResolved) return false
        if (randomRange && !validAmountRange()) return false
        if (maxSolEnabled && (isNaN(parseFloat(maxSolTotal)) || parseFloat(maxSolTotal) <= 0)) return false
        if (slippage <= 0) return false
        if (!validDelayRange()) return false
        if (selectedWallets.size === 0) return false
        return true
    }, [step, tokenResolved, randomRange, rangeMin, rangeMax, maxSolEnabled, maxSolTotal, slippage, delayMin, delayMax, selectedWallets])

    function handleNext() {
        if (step === 0 && tradeType === 'buy') {
            const TX_FEE_BUFFER = 10_000
            const failLabels: { id: string; label: string }[] = []
            const failIds = new Set<string>()
            for (const id of selectedWallets) {
                const wallet    = wallets.find((w) => w.id === id)
                const amountStr = tradeAmounts[id]
                if (!wallet) continue
                const balance = wallet.solana_balance_in_lamports
                if (!balance || balance.isZero()) {
                    failLabels.push({ id, label: wallet.label ?? maskPubKey(wallet.public_key) })
                    failIds.add(id)
                    continue
                }
                if (!amountStr) continue
                let buyLamports: BN
                try { buyLamports = solStringToLamports(amountStr) } catch { continue }
                const required = new BN(Math.ceil(buyLamports.toNumber() * (1 + slippage)) + TX_FEE_BUFFER)
                if (balance.lt(required)) {
                    failLabels.push({ id, label: wallet.label ?? maskPubKey(wallet.public_key) })
                    failIds.add(id)
                }
            }
            if (failLabels.length > 0) {
                setNextError(failLabels)
                setErrorWalletIds(failIds)
                return
            }
        }
        if (step === 0) setSchedule(buildSchedule())
        setStep((s) => s + 1)
    }

    // ── execution ─────────────────────────────────────────────────────────────

    function handlePause() {
        pauseRef.current = true
        setExecPhase('paused')
    }

    function handleResume() {
        pauseRef.current = false
        setExecPhase('running')
    }

    function handleCancel() {
        abortRef.current = true
        pauseRef.current = false   // unblock any paused wait so the loop can exit
    }

    async function executeAll() {
        abortRef.current = false
        pauseRef.current = false
        setExecPhase('running')
        setExecState(schedule.map((e) => ({ walletId: e.walletId, status: 'pending' })))

        for (let i = 0; i < schedule.length; i++) {
            // Wait out any pause before starting the next trade
            while (pauseRef.current && !abortRef.current) {
                await new Promise<void>((r) => setTimeout(r, 100))
            }
            if (abortRef.current) break

            const entry = schedule[i]

            setExecState((prev) => prev.map((s) =>
                s.walletId === entry.walletId ? { ...s, status: 'executing' } : s
            ))

            try {
                let apiResult: { success: boolean; signature?: string; error?: string }

                if (tradeType === 'buy') {
                    const solAmt   = tradeAmounts[entry.walletId] ?? '0'
                    const lamports = Math.round(parseFloat(solAmt) * 1_000_000_000).toString()
                    const res      = await fetch('/api/trade/staggered/buy', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ walletId: entry.walletId, mintAddress: tokenMint, solAmountLamports: lamports, slippage }),
                    })
                    apiResult = await res.json()
                } else {
                    const tokenAmt = tradeAmounts[entry.walletId] ?? '0'
                    const pct      = parseFloat(sellPct)
                    const res      = await fetch('/api/trade/staggered/sell', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ walletId: entry.walletId, mintAddress: tokenMint, tokenAmount: tokenAmt, slippage, sellPct: isNaN(pct) ? undefined : pct }),
                    })
                    apiResult = await res.json()
                }

                setExecState((prev) => prev.map((s) =>
                    s.walletId === entry.walletId
                        ? { ...s, status: apiResult.success ? 'success' : 'error', signature: apiResult.signature, error: apiResult.error }
                        : s
                ))
            } catch (err) {
                setExecState((prev) => prev.map((s) =>
                    s.walletId === entry.walletId
                        ? { ...s, status: 'error', error: err instanceof Error ? err.message : 'Network error' }
                        : s
                ))
            }

            // Countdown before the next trade (pause-aware)
            if (i < schedule.length - 1 && entry.delayMsAfter > 0 && !abortRef.current) {
                setExecNextWalletId(schedule[i + 1].walletId)
                await countdownSleep(entry.delayMsAfter, (remaining) => setExecCountdownMs(remaining), pauseRef, abortRef)
                setExecCountdownMs(null)
                setExecNextWalletId(null)
            }
        }

        // Mark any still-pending/executing entries as cancelled
        if (abortRef.current) {
            setExecState((prev) => prev.map((s) =>
                s.status === 'pending' || s.status === 'executing' ? { ...s, status: 'cancelled' } : s
            ))
            setExecCountdownMs(null)
            setExecNextWalletId(null)
            setExecPhase('cancelled')
        } else {
            setExecPhase('done')
        }
    }

    // ── render helpers ────────────────────────────────────────────────────────

    function formatAmount(walletId: string): string | null {
        const amt = tradeAmounts[walletId]
        if (!amt) return null
        if (tradeType === 'buy') return `${amt} SOL`
        const ui = Number(amt) / Math.pow(10, tokenDecimals)
        return ui.toLocaleString(undefined, { maximumFractionDigits: Math.min(tokenDecimals, 6) }) + ` ${tokenSymbol || 'tokens'}`
    }

    // ─────────────────────────────────────────────────────────────────────────

    return (
        <div className="flex flex-col gap-4">
            <p className="text-xs text-muted-foreground">
                Spread {tradeType === 'buy' ? 'buys' : 'sells'} across wallets with randomized delays between each trade to simulate organic human behavior.
            </p>
            <WizardShell
                steps={steps}
                current={step}
                onGoTo={(i) => { if (execPhase !== 'running' && execPhase !== 'paused') setStep(i) }}
                onBack={() => { if (execPhase !== 'running' && execPhase !== 'paused') setStep((s) => s - 1) }}
                onNext={handleNext}
                nextDisabled={!canProceed}
            >

                {/* ── Step 0: Parameters ─────────────────────────────────── */}
                {step === 0 && (
                    <div className="flex flex-col gap-6">

                        {/* Token */}
                        <div className="flex flex-col gap-1.5">
                            <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Token</span>
                            <div className="w-96">
                                <TokenMintInput
                                    onTokenChange={(mint, resolved, name, symbol) => {
                                        setTokenMint(mint)
                                        setTokenResolved(resolved)
                                        setTokenName(name ?? '')
                                        setTokenSymbol(symbol ?? '')
                                    }}
                                />
                            </div>
                        </div>

                        {/* Trade Type */}
                        <div className="flex flex-col gap-1.5">
                            <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Trade Type</span>
                            <div className="flex gap-1 rounded-lg border border-input p-0.5 bg-muted/40 w-fit">
                                {(['buy', 'sell'] as TradeType[]).map((t) => (
                                    <button
                                        key={t}
                                        type="button"
                                        onClick={() => setTradeType(t)}
                                        className={[
                                            'px-8 py-1.5 rounded-md text-sm font-medium transition-colors capitalize',
                                            tradeType === t
                                                ? t === 'buy' ? 'bg-green-500 text-white shadow-sm' : 'bg-red-500 text-white shadow-sm'
                                                : 'text-muted-foreground hover:text-foreground',
                                        ].join(' ')}
                                    >
                                        {t}
                                    </button>
                                ))}
                            </div>
                        </div>

                        {/* Amount controls + Slippage */}
                        <div className="flex flex-wrap items-start gap-8">
                            {tradeType === 'buy' ? (
                                <>
                                    {/* Trade in Range */}
                                    <div className="flex flex-col gap-1.5">
                                        <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Trade in Range</span>
                                        <label className="flex items-center gap-2 cursor-pointer select-none h-9">
                                            <input
                                                type="checkbox"
                                                checked={randomRange}
                                                onChange={(e) => handleRandomRangeToggle(e.target.checked)}
                                                className="size-4 rounded border border-input accent-blue-500"
                                            />
                                            <span className="text-xs font-medium text-muted-foreground">Enable</span>
                                        </label>
                                        {randomRange && (
                                            <div className="flex items-center gap-2">
                                                <div className="flex flex-col gap-1">
                                                    <span className="text-[10px] text-muted-foreground">Min SOL</span>
                                                    <input
                                                        type="number" min={0} step={0.0001} placeholder="0.00"
                                                        value={rangeMin}
                                                        onChange={(e) => handleRangeMinChange(e.target.value)}
                                                        className="w-20 rounded border border-input bg-transparent px-2 py-1 text-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                                                    />
                                                </div>
                                                <span className="text-muted-foreground text-sm mt-3">–</span>
                                                <div className="flex flex-col gap-1">
                                                    <span className="text-[10px] text-muted-foreground">Max SOL</span>
                                                    <input
                                                        type="number" min={0} step={0.0001} placeholder="0.00"
                                                        value={rangeMax}
                                                        onChange={(e) => handleRangeMaxChange(e.target.value)}
                                                        className="w-20 rounded border border-input bg-transparent px-2 py-1 text-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                                                    />
                                                </div>
                                            </div>
                                        )}
                                    </div>

                                    {/* Max SOL Split */}
                                    <div className="flex flex-col gap-1.5">
                                        <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Max SOL Split</span>
                                        <label className="flex items-center gap-2 cursor-pointer select-none h-9">
                                            <input
                                                type="checkbox"
                                                checked={maxSolEnabled}
                                                onChange={(e) => handleMaxSolToggle(e.target.checked)}
                                                className="size-4 rounded border border-input accent-blue-500"
                                            />
                                            <span className="text-xs font-medium text-muted-foreground">Enable</span>
                                        </label>
                                        {maxSolEnabled && (
                                            <div className="flex flex-col gap-1">
                                                <div className="flex items-center gap-2">
                                                    <input
                                                        type="number" min={0} step={0.0001} placeholder="0.00"
                                                        value={maxSolTotal}
                                                        onChange={(e) => handleMaxSolChange(e.target.value)}
                                                        className="w-24 rounded border border-input bg-transparent px-2 py-1 text-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                                                    />
                                                    <span className="text-xs text-muted-foreground">SOL</span>
                                                </div>
                                                {selectedWallets.size > 0 && maxSolTotal && !isNaN(parseFloat(maxSolTotal)) && (
                                                    <span className="text-[10px] text-muted-foreground tabular-nums">
                                                        = {(parseFloat(maxSolTotal) / selectedWallets.size).toFixed(4)} per wallet
                                                    </span>
                                                )}
                                            </div>
                                        )}
                                    </div>
                                </>
                            ) : (
                                /* Sell percentage */
                                <div className="flex flex-col gap-1.5">
                                    <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Amount to Sell</span>
                                    <div className="flex gap-1.5">
                                        {[25, 50, 75, 100].map((p) => (
                                            <button
                                                key={p}
                                                type="button"
                                                onClick={() => handleSellPctChange(String(p))}
                                                className={[
                                                    'px-3 py-1.5 rounded-md text-xs font-medium border transition-colors',
                                                    sellPct === String(p)
                                                        ? 'bg-red-500 border-red-500 text-white'
                                                        : 'border-border text-muted-foreground hover:border-red-400 hover:text-foreground',
                                                ].join(' ')}
                                            >
                                                {p}%
                                            </button>
                                        ))}
                                    </div>
                                    <div className="flex items-center gap-2 rounded-lg border border-input bg-transparent px-3 h-9 focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50 dark:bg-input/30">
                                        <input
                                            type="number" min={0} max={100} step={1} placeholder="0"
                                            value={sellPct}
                                            onChange={(e) => handleSellPctChange(e.target.value)}
                                            className="w-16 bg-transparent text-xs outline-none placeholder:text-muted-foreground [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                                        />
                                        <span className="text-xs text-muted-foreground shrink-0">%</span>
                                    </div>
                                </div>
                            )}

                            {/* Slippage */}
                            <div className="flex flex-col gap-1.5 min-w-48">
                                <SlippageControl value={slippage} onChange={setSlippage} />
                            </div>
                        </div>

                        {/* Delay between trades */}
                        <div className="flex flex-col gap-1.5">
                            <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Delay Between Trades</span>
                            <div className="flex items-end gap-3">
                                <div className="flex flex-col gap-1">
                                    <span className="text-[10px] text-muted-foreground">Min (seconds)</span>
                                    <input
                                        type="number" min={0} step={1} placeholder="5"
                                        value={delayMin}
                                        onChange={(e) => setDelayMin(e.target.value)}
                                        className="w-24 rounded border border-input bg-transparent px-2 py-1 text-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                                    />
                                </div>
                                <span className="text-muted-foreground text-sm mb-1.5">–</span>
                                <div className="flex flex-col gap-1">
                                    <span className="text-[10px] text-muted-foreground">Max (seconds)</span>
                                    <input
                                        type="number" min={0} step={1} placeholder="30"
                                        value={delayMax}
                                        onChange={(e) => setDelayMax(e.target.value)}
                                        className="w-24 rounded border border-input bg-transparent px-2 py-1 text-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                                    />
                                </div>
                                {validDelayRange() && (
                                    <span className="text-[10px] text-muted-foreground mb-1.5">
                                        random {delayMin}s – {delayMax}s between each trade
                                    </span>
                                )}
                            </div>
                        </div>

                        {/* Wallet selector */}
                        <StrategyWalletSelector
                            selectedIds={selectedWallets}
                            onSelectionChange={handleSelectionChange}
                            onTradeAmountChange={(id, amt) => setTradeAmounts((p) => ({ ...p, [id]: amt }))}
                            onTradeAmountReset={() => setTradeAmounts({})}
                            defaultTypeName="Trader"
                            tradeAmounts={tradeAmounts}
                            errorIds={errorWalletIds}
                            tradeType={tradeType}
                            tokenMint={tokenMint}
                            onBalancesLoaded={(balances, decimals) => {
                                setTokenBalances(balances)
                                setTokenDecimals(decimals)
                            }}
                        />

                        {nextError.length > 0 && (
                            <div role="alert" className="flex gap-3 rounded-lg border border-destructive/50 bg-destructive/10 px-4 py-3 text-destructive">
                                <svg className="mt-0.5 size-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                    <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                                    <line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" />
                                </svg>
                                <div className="flex flex-col gap-1">
                                    <p className="text-xs font-semibold leading-none">Insufficient SOL</p>
                                    <p className="text-xs text-destructive/80">
                                        These wallets lack enough SOL to cover the buy amount plus fees:
                                    </p>
                                    <ul className="mt-0.5 flex flex-col gap-0.5">
                                        {nextError.map(({ id, label }) => (
                                            <li key={id} className="text-xs font-mono text-destructive/80">{label}</li>
                                        ))}
                                    </ul>
                                </div>
                            </div>
                        )}
                    </div>
                )}

                {/* ── Step 1: Schedule Preview ────────────────────────────── */}
                {step === 1 && (() => {
                    const totalDelayMs = schedule.reduce((s, e) => s + e.delayMsAfter, 0)
                    return (
                        <div className="flex flex-col gap-4">
                            <div className="flex items-center justify-between">
                                <p className="text-xs text-muted-foreground">
                                    {schedule.length} trade{schedule.length !== 1 ? 's' : ''} · ~{(totalDelayMs / 1000).toFixed(0)}s total wait
                                </p>
                                <button
                                    type="button"
                                    onClick={() => setSchedule(buildSchedule())}
                                    className="text-[10px] border border-border rounded px-2.5 py-1 text-muted-foreground hover:text-foreground hover:border-foreground/40 transition-colors"
                                >
                                    ↺ Regenerate
                                </button>
                            </div>

                            <div className="flex flex-col">
                                {schedule.map((entry, i) => {
                                    const wallet = wallets.find((w) => w.id === entry.walletId)
                                    const amt    = formatAmount(entry.walletId)
                                    return (
                                        <div key={entry.walletId}>
                                            <div className="flex items-center gap-3 rounded-lg border border-border bg-muted/10 px-3 py-2.5">
                                                <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-blue-500/10 text-[10px] font-semibold text-blue-500">
                                                    {i + 1}
                                                </span>
                                                <div className="flex flex-col flex-1 min-w-0">
                                                    <span className="text-xs font-mono truncate">
                                                        {wallet?.label && (
                                                            <span className="font-sans font-medium text-foreground">{wallet.label} · </span>
                                                        )}
                                                        {wallet ? maskPubKey(wallet.public_key) : maskPubKey(entry.walletId)}
                                                    </span>
                                                    {wallet?.solana_balance_in_lamports && (
                                                        <span className="text-[10px] text-muted-foreground tabular-nums">
                                                            {lamportsBNToSolDisplay(wallet.solana_balance_in_lamports)} SOL balance
                                                        </span>
                                                    )}
                                                </div>
                                                {amt && (
                                                    <span className={[
                                                        'shrink-0 text-xs font-semibold tabular-nums',
                                                        tradeType === 'buy' ? 'text-green-500' : 'text-red-500',
                                                    ].join(' ')}>
                                                        {amt}
                                                    </span>
                                                )}
                                            </div>
                                            {entry.delayMsAfter > 0 && (
                                                <div className="flex items-center gap-2 px-3 py-1">
                                                    <div className="w-px h-4 bg-muted-foreground/20 ml-3" />
                                                    <span className="text-[10px] text-muted-foreground tabular-nums">
                                                        wait {(entry.delayMsAfter / 1000).toFixed(1)}s
                                                    </span>
                                                </div>
                                            )}
                                        </div>
                                    )
                                })}
                            </div>
                        </div>
                    )
                })()}

                {/* ── Step 2: Review ──────────────────────────────────────── */}
                {step === 2 && (() => {
                    const totalBuySol  = tradeType === 'buy'
                        ? [...selectedWallets].reduce((s, id) => s + (parseFloat(tradeAmounts[id] ?? '0') || 0), 0)
                        : 0
                    const totalDelayMs = schedule.reduce((s, e) => s + e.delayMsAfter, 0)

                    return (
                        <div className="flex flex-col gap-5">
                            <div className="rounded-lg border border-border overflow-hidden divide-y divide-border text-xs">
                                <div className="flex items-center gap-3 px-4 py-2.5 bg-muted/20">
                                    <span className="w-32 shrink-0 font-medium text-muted-foreground">Token</span>
                                    <span className="flex items-center gap-1.5">
                                        {tokenName && <span className="font-medium text-foreground">{tokenName}</span>}
                                        {tokenSymbol && <span className="text-muted-foreground">({tokenSymbol})</span>}
                                        <span className="font-mono text-[11px] text-muted-foreground">{maskPubKey(tokenMint)}</span>
                                    </span>
                                </div>
                                <div className="flex items-center gap-3 px-4 py-2.5">
                                    <span className="w-32 shrink-0 font-medium text-muted-foreground">Trade Type</span>
                                    <span className={tradeType === 'buy' ? 'font-medium text-green-500 capitalize' : 'font-medium text-red-500 capitalize'}>
                                        {tradeType}
                                    </span>
                                </div>
                                {tradeType === 'sell' && sellPct && (
                                    <div className="flex items-center gap-3 px-4 py-2.5 bg-muted/20">
                                        <span className="w-32 shrink-0 font-medium text-muted-foreground">Sell Amount</span>
                                        <span className="tabular-nums text-foreground">{sellPct}%</span>
                                    </div>
                                )}
                                {tradeType === 'buy' && randomRange && (
                                    <div className="flex items-center gap-3 px-4 py-2.5 bg-muted/20">
                                        <span className="w-32 shrink-0 font-medium text-muted-foreground">Trade Range</span>
                                        <span className="tabular-nums text-foreground">{rangeMin} – {rangeMax} SOL</span>
                                    </div>
                                )}
                                {tradeType === 'buy' && maxSolEnabled && maxSolTotal && (
                                    <div className="flex items-center gap-3 px-4 py-2.5 bg-muted/20">
                                        <span className="w-32 shrink-0 font-medium text-muted-foreground">Max SOL Split</span>
                                        <span className="tabular-nums text-foreground">
                                            {maxSolTotal} SOL ÷ {selectedWallets.size} = {(parseFloat(maxSolTotal) / selectedWallets.size).toFixed(4)} each
                                        </span>
                                    </div>
                                )}
                                <div className="flex items-center gap-3 px-4 py-2.5">
                                    <span className="w-32 shrink-0 font-medium text-muted-foreground">Slippage</span>
                                    <span className="tabular-nums text-foreground">{(slippage * 100).toFixed(1)}%</span>
                                </div>
                                <div className="flex items-center gap-3 px-4 py-2.5 bg-muted/20">
                                    <span className="w-32 shrink-0 font-medium text-muted-foreground">Delay Range</span>
                                    <span className="tabular-nums text-foreground">{delayMin}s – {delayMax}s between trades</span>
                                </div>
                                <div className="flex items-center gap-3 px-4 py-2.5">
                                    <span className="w-32 shrink-0 font-medium text-muted-foreground">Wallets</span>
                                    <span className="text-foreground">{selectedWallets.size}</span>
                                </div>
                                {tradeType === 'buy' && (
                                    <div className="flex items-center gap-3 px-4 py-2.5 bg-muted/20">
                                        <span className="w-32 shrink-0 font-medium text-muted-foreground">Total SOL</span>
                                        <span className="tabular-nums font-semibold text-green-500">{totalBuySol.toFixed(4)} SOL</span>
                                    </div>
                                )}
                                <div className="flex items-center gap-3 px-4 py-2.5">
                                    <span className="w-32 shrink-0 font-medium text-muted-foreground">Est. Duration</span>
                                    <span className="tabular-nums text-foreground">~{(totalDelayMs / 1000).toFixed(0)}s</span>
                                </div>
                            </div>

                            {/* Execution order table */}
                            <div className="flex flex-col gap-2">
                                <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                                    Execution Order ({schedule.length})
                                </span>
                                <div className="rounded-lg border border-border overflow-hidden">
                                    <table className="w-full text-xs">
                                        <thead>
                                            <tr className="bg-muted/30 border-b border-border">
                                                <th className="px-3 py-2 text-left font-medium text-muted-foreground w-8">#</th>
                                                <th className="px-3 py-2 text-left font-medium text-muted-foreground">Wallet</th>
                                                <th className="px-3 py-2 text-right font-medium text-muted-foreground">Amount</th>
                                                <th className="px-3 py-2 text-right font-medium text-muted-foreground">Delay After</th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-border">
                                            {schedule.map((entry, i) => {
                                                const w   = wallets.find((wl) => wl.id === entry.walletId)
                                                const amt = formatAmount(entry.walletId)
                                                return (
                                                    <tr key={entry.walletId}>
                                                        <td className="px-3 py-2 text-muted-foreground">{i + 1}</td>
                                                        <td className="px-3 py-2 font-mono text-[11px]">
                                                            {w?.label && <span className="font-sans text-xs text-foreground">{w.label} · </span>}
                                                            {w ? maskPubKey(w.public_key) : maskPubKey(entry.walletId)}
                                                        </td>
                                                        <td className="px-3 py-2 text-right tabular-nums font-medium">
                                                            {amt
                                                                ? <span className={tradeType === 'buy' ? 'text-green-500' : 'text-red-500'}>{amt}</span>
                                                                : <span className="text-muted-foreground">—</span>}
                                                        </td>
                                                        <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">
                                                            {entry.delayMsAfter > 0 ? `${(entry.delayMsAfter / 1000).toFixed(1)}s` : '—'}
                                                        </td>
                                                    </tr>
                                                )
                                            })}
                                        </tbody>
                                    </table>
                                </div>
                            </div>
                        </div>
                    )
                })()}

                {/* ── Step 3: Execute ─────────────────────────────────────── */}
                {step === 3 && (
                    <div className="flex flex-col gap-4">

                        {/* Control bar */}
                        <div className="flex items-center gap-2">
                            {execPhase === 'idle' && (
                                <button
                                    type="button"
                                    onClick={executeAll}
                                    className="flex items-center gap-2 px-4 py-2 rounded-lg bg-blue-500 text-white text-sm font-medium hover:bg-blue-600 transition-colors"
                                >
                                    <svg className="size-4" viewBox="0 0 24 24" fill="currentColor">
                                        <polygon points="5 3 19 12 5 21 5 3" />
                                    </svg>
                                    Start Execution
                                </button>
                            )}
                            {execPhase === 'running' && (
                                <>
                                    <button
                                        type="button"
                                        onClick={handlePause}
                                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-amber-500/60 bg-amber-500/10 text-amber-500 text-xs font-medium hover:bg-amber-500/20 transition-colors"
                                    >
                                        <svg className="size-3.5" viewBox="0 0 24 24" fill="currentColor">
                                            <rect x="6" y="4" width="4" height="16" /><rect x="14" y="4" width="4" height="16" />
                                        </svg>
                                        Pause
                                    </button>
                                    <button
                                        type="button"
                                        onClick={handleCancel}
                                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-destructive/60 bg-destructive/10 text-destructive text-xs font-medium hover:bg-destructive/20 transition-colors"
                                    >
                                        <svg className="size-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                                            <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                                        </svg>
                                        Cancel
                                    </button>
                                </>
                            )}
                            {execPhase === 'paused' && (
                                <>
                                    <button
                                        type="button"
                                        onClick={handleResume}
                                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-blue-500/60 bg-blue-500/10 text-blue-500 text-xs font-medium hover:bg-blue-500/20 transition-colors"
                                    >
                                        <svg className="size-3.5" viewBox="0 0 24 24" fill="currentColor">
                                            <polygon points="5 3 19 12 5 21 5 3" />
                                        </svg>
                                        Resume
                                    </button>
                                    <button
                                        type="button"
                                        onClick={handleCancel}
                                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-destructive/60 bg-destructive/10 text-destructive text-xs font-medium hover:bg-destructive/20 transition-colors"
                                    >
                                        <svg className="size-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                                            <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                                        </svg>
                                        Cancel
                                    </button>
                                </>
                            )}
                            {execPhase === 'done' && (
                                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                                    <span className="inline-block size-2 rounded-full bg-green-500" />
                                    Completed · {execState.filter(e => e.status === 'success').length} succeeded
                                    {execState.some(e => e.status === 'error') && (
                                        <span className="text-destructive">· {execState.filter(e => e.status === 'error').length} failed</span>
                                    )}
                                </div>
                            )}
                            {execPhase === 'cancelled' && (
                                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                                    <span className="inline-block size-2 rounded-full bg-muted-foreground/50" />
                                    Cancelled · {execState.filter(e => e.status === 'success').length} completed
                                    {' · '}{execState.filter(e => e.status === 'cancelled').length} skipped
                                </div>
                            )}
                        </div>

                        {/* Countdown / paused banner */}
                        {execCountdownMs !== null && execNextWalletId && (
                            execPhase === 'paused' ? (
                                <div className="flex items-center gap-3 rounded-lg border border-amber-500/20 bg-amber-500/5 px-4 py-3">
                                    <svg className="size-4 shrink-0 text-amber-500" viewBox="0 0 24 24" fill="currentColor">
                                        <rect x="6" y="4" width="4" height="16" /><rect x="14" y="4" width="4" height="16" />
                                    </svg>
                                    <div className="flex flex-col gap-0.5">
                                        <span className="text-xs font-medium text-amber-500">
                                            Paused — {(execCountdownMs / 1000).toFixed(1)}s remaining
                                        </span>
                                        <span className="text-[10px] text-muted-foreground">
                                            Next: {(() => {
                                                const w = wallets.find(wl => wl.id === execNextWalletId)
                                                return w ? (w.label ?? maskPubKey(w.public_key)) : maskPubKey(execNextWalletId)
                                            })()}
                                        </span>
                                    </div>
                                </div>
                            ) : (
                                <div className="flex items-center gap-3 rounded-lg border border-blue-500/20 bg-blue-500/5 px-4 py-3">
                                    <span className="inline-block size-4 shrink-0 rounded-full border-2 border-blue-300 border-t-blue-500 animate-spin" />
                                    <div className="flex flex-col gap-0.5">
                                        <span className="text-xs font-medium text-blue-500">
                                            {(execCountdownMs / 1000).toFixed(1)}s until next trade
                                        </span>
                                        <span className="text-[10px] text-muted-foreground">
                                            Next: {(() => {
                                                const w = wallets.find(wl => wl.id === execNextWalletId)
                                                return w ? (w.label ?? maskPubKey(w.public_key)) : maskPubKey(execNextWalletId)
                                            })()}
                                        </span>
                                    </div>
                                </div>
                            )
                        )}

                        {/* Per-wallet status table */}
                        {execState.length > 0 && (
                            <div className="rounded-lg border border-border overflow-hidden">
                                <table className="w-full text-xs">
                                    <thead>
                                        <tr className="bg-muted/30 border-b border-border">
                                            <th className="px-3 py-2 text-left font-medium text-muted-foreground w-8">#</th>
                                            <th className="px-3 py-2 text-left font-medium text-muted-foreground">Wallet</th>
                                            <th className="px-3 py-2 text-right font-medium text-muted-foreground">Amount</th>
                                            <th className="px-3 py-2 text-right font-medium text-muted-foreground">Status</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-border">
                                        {execState.map((entry, i) => {
                                            const w   = wallets.find((wl) => wl.id === entry.walletId)
                                            const amt = formatAmount(entry.walletId)
                                            return (
                                                <tr
                                                    key={entry.walletId}
                                                    className={
                                                        entry.status === 'success'   ? 'bg-green-500/5' :
                                                        entry.status === 'error'     ? 'bg-destructive/5' :
                                                        entry.status === 'executing' ? 'bg-blue-500/5' :
                                                        entry.status === 'cancelled' ? 'opacity-40' :
                                                        ''
                                                    }
                                                >
                                                    <td className="px-3 py-2.5 text-muted-foreground">{i + 1}</td>
                                                    <td className="px-3 py-2.5 font-mono text-[11px]">
                                                        {w?.label && <span className="font-sans text-xs text-foreground">{w.label} · </span>}
                                                        {w ? maskPubKey(w.public_key) : maskPubKey(entry.walletId)}
                                                    </td>
                                                    <td className="px-3 py-2.5 text-right tabular-nums">
                                                        {amt
                                                            ? <span className={tradeType === 'buy' ? 'text-green-500' : 'text-red-500'}>{amt}</span>
                                                            : <span className="text-muted-foreground">—</span>}
                                                    </td>
                                                    <td className="px-3 py-2.5 text-right">
                                                        {entry.status === 'pending' && (
                                                            <span className="text-muted-foreground/50">pending</span>
                                                        )}
                                                        {entry.status === 'executing' && (
                                                            <span className="flex items-center justify-end gap-1.5 text-blue-500">
                                                                <span className="inline-block size-3 rounded-full border-2 border-blue-300 border-t-blue-500 animate-spin" />
                                                                executing
                                                            </span>
                                                        )}
                                                        {entry.status === 'success' && (
                                                            entry.signature ? (
                                                                <a
                                                                    href={`https://solscan.io/tx/${entry.signature}`}
                                                                    target="_blank"
                                                                    rel="noopener noreferrer"
                                                                    className="flex items-center justify-end gap-1.5 text-green-500 hover:text-green-400 transition-colors"
                                                                >
                                                                    ✓ <span className="font-mono text-[10px]">{entry.signature.slice(0, 8)}…</span>
                                                                </a>
                                                            ) : (
                                                                <span className="text-green-500">✓ success</span>
                                                            )
                                                        )}
                                                        {entry.status === 'error' && (
                                                            <span className="text-destructive" title={entry.error}>
                                                                ✗ {(entry.error ?? 'failed').slice(0, 40)}
                                                            </span>
                                                        )}
                                                        {entry.status === 'cancelled' && (
                                                            <span className="text-muted-foreground">skipped</span>
                                                        )}
                                                    </td>
                                                </tr>
                                            )
                                        })}
                                    </tbody>
                                </table>
                            </div>
                        )}
                    </div>
                )}

            </WizardShell>
        </div>
    )
}
