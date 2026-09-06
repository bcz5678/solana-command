'use client'

import { useState, useMemo, useEffect, useRef } from 'react'
import BN from 'bn.js'
import WizardShell, { WizardStep } from './wizard-shell'
import StrategyWalletSelector from '@/components/trade/strategy-trade/strategy-wallet-selector'
import { solStringToLamports, lamportsBNToSolDisplay, lamportsStringToBN } from '@/lib/lamports'
import { WalletRecord } from '@/lib/types/wallet'
import { SlippageControl } from '@/components/trade/trade/SlippageControl'
import { TokenMintInput } from '@/components/trade/strategy-trade/TokenMintInput'
import { stratifiedInterleave } from '@/lib/trade/stratified-interleave'
import BankPicker from '@/components/tokens/comment-bank/bank-picker'
import CommentActivityFeed from '@/components/tokens/comment-bank/comment-activity-feed'
import { useRelayEvent } from '@/hooks/use-relay-event'
import type { TokenTransactionEvent } from '@/lib/wss/types'
import { createTradeRun, upsertTradeRunStep, getTradeRun, requestTradeRunControl, finishTradeRun } from '@/lib/trade/trade-run-client'

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

function sleep(ms: number): Promise<void> {
    return new Promise((r) => setTimeout(r, ms))
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

    const [autoCommentEnabled, setAutoCommentEnabled]           = useState(false)
    const [autoCommentDelayMinSec, setAutoCommentDelayMinSec]   = useState('180')
    const [autoCommentDelayMaxSec, setAutoCommentDelayMaxSec]   = useState('1800')
    const [autoCommentProbabilityPct, setAutoCommentProbabilityPct] = useState('100')
    const [autoCommentBankIds, setAutoCommentBankIds]           = useState<Set<string>>(new Set())

    // Front-running protection — auto-pause on foreign trades detected mid-run
    const [autoHaltEnabled, setAutoHaltEnabled] = useState(false)
    const [haltThreshold, setHaltThreshold]     = useState('2')
    const [haltWindowSec, setHaltWindowSec]     = useState('10')
    const [haltAlert, setHaltAlert]             = useState<string | null>(null)

    // Schedule (generated once when leaving Parameters step)
    const [schedule, setSchedule] = useState<ScheduleEntry[]>([])

    // Live execution state
    const [execState, setExecState]             = useState<ExecEntry[]>([])
    const [execPhase, setExecPhase]             = useState<ExecPhase>('idle')
    const [execCountdownMs, setExecCountdownMs] = useState<number | null>(null)
    const [execNextWalletId, setExecNextWalletId] = useState<string | null>(null)
    const abortRef = useRef(false)
    const pauseRef = useRef(false)
    // Durable record of this run — lets a second tab (the Trade Control
    // Center) see this run's progress and request pause/cancel even if this
    // tab is later lost. Set once at the start of executeAll(), read by the
    // remote-control poll below.
    const runIdRef = useRef<string | null>(null)

    // Sniper-shakeout flush/rebuy — a manual side-flow available while paused.
    // Fully independent of pauseRef/abortRef: every candidate here is a
    // wallet the main loop has already finished with (status 'success' in
    // execState) and will never revisit, so there's no possible collision
    // with the paused loop regardless of timing. Persists across a
    // pause->resume->pause cycle within the same run (only reset when a new
    // run starts) so prior flush history is still visible on a repeat pause.
    type FlushSubStatus =
        | 'idle' | 'selling' | 'sold' | 'error-selling'
        | 'rebuying' | 'rebought' | 'error-rebuying'
    type FlushEntry = {
        walletId:        string
        subStatus:       FlushSubStatus
        sellSignature?:  string
        rebuySignature?: string
        error?:          string
    }
    const [flushSelectedIds, setFlushSelectedIds] = useState<Set<string>>(new Set())
    const [flushSellPct, setFlushSellPct]         = useState('50')
    const [flushEntries, setFlushEntries]         = useState<FlushEntry[]>([])
    const [flushBusy, setFlushBusy]               = useState<'selling' | 'rebuying' | null>(null)

    // Run-scoped, non-rendered state for the auto-halt detector — mutated
    // directly by executeAll(), read by the relay-event handler below.
    const autoHaltActiveRef        = useRef(false)
    const runWalletKeysRef         = useRef<Set<string>>(new Set())
    const foreignTradeTimestampsRef = useRef<number[]>([])

    // Watches every live trade for the current mint (the relay broadcasts to
    // all connected clients — filtering by mint/wallet happens here, same
    // pattern as launch-trade-feed-panel.tsx). A trade from a wallet that
    // ISN'T part of this run's own schedule counts as "foreign"; enough of
    // those in a short trailing window auto-pauses so a human can judge
    // whether it's a real sniper before deciding to resume or cancel.
    useRelayEvent('token-transaction', (e: TokenTransactionEvent) => {
        if (!autoHaltActiveRef.current || !autoHaltEnabled) return
        if (e.mint !== tokenMint) return
        if (runWalletKeysRef.current.has(e.wallet)) return

        const windowMs = (parseFloat(haltWindowSec) || 10) * 1000
        const threshold = parseInt(haltThreshold) || 2
        const now = Date.now()
        const pruned = [...foreignTradeTimestampsRef.current, now].filter((t) => now - t <= windowMs)
        foreignTradeTimestampsRef.current = pruned

        if (pruned.length >= threshold) {
            foreignTradeTimestampsRef.current = []
            pauseRef.current = true
            setExecPhase('paused')
            setHaltAlert(
                `Auto-paused — ${pruned.length} external trade${pruned.length !== 1 ? 's' : ''} on this token in the last ${windowMs / 1000}s ` +
                `(most recent: ${e.wallet.slice(0, 4)}…${e.wallet.slice(-4)}, ${e.txType} ${Math.abs(e.tokenAmount).toLocaleString(undefined, { maximumFractionDigits: 2 })} tokens)`
            )
        }
    })

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

    // Remote control poll — lets the Trade Control Center (a second tab)
    // pause/cancel this run. Mirrors the front-run auto-halt handler above:
    // an external async source mutating pauseRef/abortRef directly, which
    // the existing pause-wait loop and countdownSleep already pick up within
    // 100ms from anywhere. Stays active while paused (not just while
    // running) so a remote Resume request is still observed.
    useEffect(() => {
        if (execPhase !== 'running' && execPhase !== 'paused') return
        const id = setInterval(async () => {
            const runId = runIdRef.current
            if (!runId) return
            const run = await getTradeRun(runId)
            if (!run) return
            if (run.control === 'pause_requested') {
                pauseRef.current = true
                setExecPhase('paused')
                requestTradeRunControl(runId, 'none')
            } else if (run.control === 'resume_requested') {
                pauseRef.current = false
                setHaltAlert(null)
                setExecPhase('running')
                requestTradeRunControl(runId, 'none')
            } else if (run.control === 'cancel_requested') {
                abortRef.current = true
                pauseRef.current = false
                requestTradeRunControl(runId, 'none')
            }
        }, 3000)
        return () => clearInterval(id)
    }, [execPhase])

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
        // Stratified interleave, not a plain shuffle — spreads large trade
        // amounts evenly across the run instead of leaving it to chance
        // whether they cluster together. A monotonic size ramp in either
        // direction is itself a detectable pattern to sniper/copy-trade bots.
        const shuffled = stratifiedInterleave(
            [...selectedWallets],
            (id) => parseFloat(tradeAmounts[id] ?? '0') || 0,
        )
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
        if (autoCommentEnabled) {
            const dMin = parseFloat(autoCommentDelayMinSec), dMax = parseFloat(autoCommentDelayMaxSec)
            const prob = parseFloat(autoCommentProbabilityPct)
            if (isNaN(dMin) || isNaN(dMax) || dMax < dMin || dMin < 0) return false
            if (isNaN(prob) || prob < 0 || prob > 100) return false
            if (autoCommentBankIds.size === 0) return false
        }
        if (autoHaltEnabled) {
            const threshold = parseInt(haltThreshold)
            const window = parseFloat(haltWindowSec)
            if (isNaN(threshold) || threshold < 1) return false
            if (isNaN(window) || window <= 0) return false
        }
        return true
    }, [step, tokenResolved, randomRange, rangeMin, rangeMax, maxSolEnabled, maxSolTotal, slippage, delayMin, delayMax, selectedWallets, autoCommentEnabled, autoCommentDelayMinSec, autoCommentDelayMaxSec, autoCommentProbabilityPct, autoCommentBankIds, autoHaltEnabled, haltThreshold, haltWindowSec])

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
        setHaltAlert(null)
        setExecPhase('running')
    }

    function handleCancel() {
        abortRef.current = true
        pauseRef.current = false   // unblock any paused wait so the loop can exit
    }

    async function executeAll() {
        abortRef.current = false
        pauseRef.current = false
        setHaltAlert(null)
        setExecPhase('running')
        setExecState(schedule.map((e) => ({ walletId: e.walletId, status: 'pending' })))
        setFlushEntries([])
        setFlushSelectedIds(new Set())

        runIdRef.current = await createTradeRun(
            tradeType === 'buy' ? 'staggered_buy' : 'staggered_sell',
            tokenMint,
            tokenSymbol || tokenName || null,
            schedule.length,
        )

        // Build this run's own wallet-pubkey set so the relay-event handler
        // can tell "one of ours" from "foreign" — deliberately narrower than
        // the platform-wide wallet list, scoped to just this run's schedule.
        runWalletKeysRef.current = new Set(
            schedule
                .map((e) => wallets.find((w) => w.id === e.walletId)?.public_key)
                .filter((pk): pk is string => !!pk),
        )
        foreignTradeTimestampsRef.current = []

        if (autoHaltEnabled) {
            // Await confirmation the relay is actually watching this mint
            // BEFORE any buy fires — a fire-and-forget watch call leaves a
            // race window where an early foreign trade could land before
            // we're subscribed to see it.
            try {
                await fetch('/api/wss/tokens/watch', {
                    method:  'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body:    JSON.stringify({ mint: tokenMint }),
                })
            } catch {
                // Best-effort — proceed without auto-halt protection rather
                // than block the run on a relay hiccup.
            }
        }
        autoHaltActiveRef.current = autoHaltEnabled

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
            upsertTradeRunStep(runIdRef.current, {
                stepKey: entry.walletId, stepIndex: i, walletId: entry.walletId,
                status: 'running', amount: formatAmount(entry.walletId),
            })

            try {
                let apiResult: { success: boolean; signature?: string; error?: string }

                if (tradeType === 'buy') {
                    const solAmt   = tradeAmounts[entry.walletId] ?? '0'
                    const lamports = Math.round(parseFloat(solAmt) * 1_000_000_000).toString()
                    const res      = await fetch('/api/trade/staggered/buy', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            walletId: entry.walletId,
                            mintAddress: tokenMint,
                            solAmountLamports: lamports,
                            slippage,
                            ...(autoCommentEnabled ? {
                                autoComment: {
                                    enabled:     true,
                                    delayMinMs:  (parseFloat(autoCommentDelayMinSec) || 0) * 1000,
                                    delayMaxMs:  (parseFloat(autoCommentDelayMaxSec) || 0) * 1000,
                                    probability: (parseFloat(autoCommentProbabilityPct) || 0) / 100,
                                    bankIds:     [...autoCommentBankIds],
                                },
                            } : {}),
                        }),
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
                upsertTradeRunStep(runIdRef.current, {
                    stepKey: entry.walletId, stepIndex: i, walletId: entry.walletId,
                    status: apiResult.success ? 'success' : 'error',
                    amount: formatAmount(entry.walletId), signature: apiResult.signature, error: apiResult.error,
                })
            } catch (err) {
                const message = err instanceof Error ? err.message : 'Network error'
                setExecState((prev) => prev.map((s) =>
                    s.walletId === entry.walletId
                        ? { ...s, status: 'error', error: message }
                        : s
                ))
                upsertTradeRunStep(runIdRef.current, {
                    stepKey: entry.walletId, stepIndex: i, walletId: entry.walletId,
                    status: 'error', amount: formatAmount(entry.walletId), error: message,
                })
            }

            // Countdown before the next trade (pause-aware)
            if (i < schedule.length - 1 && entry.delayMsAfter > 0 && !abortRef.current) {
                setExecNextWalletId(schedule[i + 1].walletId)
                await countdownSleep(entry.delayMsAfter, (remaining) => setExecCountdownMs(remaining), pauseRef, abortRef)
                setExecCountdownMs(null)
                setExecNextWalletId(null)
            }
        }

        autoHaltActiveRef.current = false
        if (autoHaltEnabled) {
            fetch('/api/wss/tokens/unwatch', {
                method:  'POST',
                headers: { 'Content-Type': 'application/json' },
                body:    JSON.stringify({ mint: tokenMint }),
            }).catch(() => {})
        }

        // Mark any still-pending/executing entries as cancelled
        if (abortRef.current) {
            setExecState((prev) => {
                const next = prev.map((s) =>
                    s.status === 'pending' || s.status === 'executing' ? { ...s, status: 'cancelled' as const } : s
                )
                next.forEach((s, i) => {
                    if (s.status === 'cancelled') {
                        upsertTradeRunStep(runIdRef.current, { stepKey: s.walletId, stepIndex: i, walletId: s.walletId, status: 'cancelled' })
                    }
                })
                return next
            })
            setExecCountdownMs(null)
            setExecNextWalletId(null)
            setExecPhase('cancelled')
            finishTradeRun(runIdRef.current, 'cancelled')
        } else {
            setExecPhase('done')
            finishTradeRun(runIdRef.current, 'done')
        }
    }

    // ── sniper-shakeout flush/rebuy ──────────────────────────────────────────

    async function sellSelectedForFlush(pct: number) {
        const ids = [...flushSelectedIds]
        setFlushBusy('selling')
        for (let i = 0; i < ids.length; i++) {
            const walletId = ids[i]
            setFlushEntries((prev) => [...prev.filter((e) => e.walletId !== walletId), { walletId, subStatus: 'selling' }])
            try {
                const res = await fetch('/api/trade/staggered/sell', {
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ walletId, mintAddress: tokenMint, slippage, sellPct: pct }),
                })
                const result = await res.json()
                setFlushEntries((prev) => prev.map((e) => e.walletId === walletId
                    ? { ...e, subStatus: result.success ? 'sold' : 'error-selling', sellSignature: result.signature, error: result.error } : e))
                upsertTradeRunStep(runIdRef.current, {
                    stepKey: `${walletId}:flush-sell`, walletId,
                    status: result.success ? 'success' : 'error',
                    amount: `${pct}% flush-sell`, signature: result.signature, error: result.error,
                })
            } catch (err) {
                const message = err instanceof Error ? err.message : 'Network error'
                setFlushEntries((prev) => prev.map((e) => e.walletId === walletId ? { ...e, subStatus: 'error-selling', error: message } : e))
                upsertTradeRunStep(runIdRef.current, { stepKey: `${walletId}:flush-sell`, walletId, status: 'error', error: message })
            }
            if (i < ids.length - 1) await sleep(500)
        }
        setFlushBusy(null)
    }

    async function rebuySelectedForFlush() {
        const ids = flushEntries.filter((e) => e.subStatus === 'sold' && flushSelectedIds.has(e.walletId)).map((e) => e.walletId)
        setFlushBusy('rebuying')
        for (let i = 0; i < ids.length; i++) {
            const walletId = ids[i]
            setFlushEntries((prev) => prev.map((e) => e.walletId === walletId ? { ...e, subStatus: 'rebuying' } : e))
            try {
                const solAmt   = tradeAmounts[walletId] ?? '0'   // original buy amount — restores full position
                const lamports = Math.round(parseFloat(solAmt) * 1_000_000_000).toString()
                const res = await fetch('/api/trade/staggered/buy', {
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ walletId, mintAddress: tokenMint, solAmountLamports: lamports, slippage }),
                })
                const result = await res.json()
                setFlushEntries((prev) => prev.map((e) => e.walletId === walletId
                    ? { ...e, subStatus: result.success ? 'rebought' : 'error-rebuying', rebuySignature: result.signature, error: result.error } : e))
                upsertTradeRunStep(runIdRef.current, {
                    stepKey: `${walletId}:flush-buy`, walletId,
                    status: result.success ? 'success' : 'error',
                    amount: formatAmount(walletId), signature: result.signature, error: result.error,
                })
            } catch (err) {
                const message = err instanceof Error ? err.message : 'Network error'
                setFlushEntries((prev) => prev.map((e) => e.walletId === walletId ? { ...e, subStatus: 'error-rebuying', error: message } : e))
                upsertTradeRunStep(runIdRef.current, { stepKey: `${walletId}:flush-buy`, walletId, status: 'error', error: message })
            }
            if (i < ids.length - 1) await sleep(500)
        }
        setFlushBusy(null)
    }

    // ── render helpers ────────────────────────────────────────────────────────

    function formatAmount(walletId: string): string | null {
        const amt = tradeAmounts[walletId]
        if (!amt) return null
        if (tradeType === 'buy') return `${amt} SOL`
        const ui = Number(amt) / Math.pow(10, tokenDecimals)
        return ui.toLocaleString(undefined, { maximumFractionDigits: Math.min(tokenDecimals, 6) }) + ` ${tokenSymbol || 'tokens'}`
    }

    // Flush/rebuy candidates — already-successful wallets, biggest buys first
    // (matches "sell some of the bigger ones" — no separate UI needed to
    // explain the ordering).
    const flushCandidates = useMemo(() => {
        return execState
            .filter((e) => e.status === 'success')
            .map((e) => ({
                walletId: e.walletId,
                wallet:   wallets.find((w) => w.id === e.walletId),
                amountSol: parseFloat(tradeAmounts[e.walletId] ?? '0') || 0,
            }))
            .sort((a, b) => b.amountSol - a.amountSol)
    }, [execState, wallets, tradeAmounts])

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

                                    {/* Auto-Comment */}
                                    <div className="flex flex-col gap-1.5">
                                        <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Auto-Comment</span>
                                        <label className="flex items-center gap-2 cursor-pointer select-none h-9">
                                            <input
                                                type="checkbox"
                                                checked={autoCommentEnabled}
                                                onChange={(e) => setAutoCommentEnabled(e.target.checked)}
                                                className="size-4 rounded border border-input accent-blue-500"
                                            />
                                            <span className="text-xs font-medium text-muted-foreground">Enable</span>
                                        </label>
                                        {autoCommentEnabled && (
                                            <div className="flex flex-col gap-1.5">
                                                <div className="flex items-center gap-2">
                                                    <div className="flex flex-col gap-1">
                                                        <span className="text-[10px] text-muted-foreground">Delay min (sec)</span>
                                                        <input
                                                            type="number" min={0}
                                                            value={autoCommentDelayMinSec}
                                                            onChange={(e) => setAutoCommentDelayMinSec(e.target.value)}
                                                            className="w-20 rounded border border-input bg-transparent px-2 py-1 text-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                                                        />
                                                    </div>
                                                    <span className="text-muted-foreground text-sm mt-3">–</span>
                                                    <div className="flex flex-col gap-1">
                                                        <span className="text-[10px] text-muted-foreground">Delay max (sec)</span>
                                                        <input
                                                            type="number" min={0}
                                                            value={autoCommentDelayMaxSec}
                                                            onChange={(e) => setAutoCommentDelayMaxSec(e.target.value)}
                                                            className="w-20 rounded border border-input bg-transparent px-2 py-1 text-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                                                        />
                                                    </div>
                                                </div>
                                                <div className="flex flex-col gap-1">
                                                    <span className="text-[10px] text-muted-foreground">Chance to comment (%)</span>
                                                    <input
                                                        type="number" min={0} max={100}
                                                        value={autoCommentProbabilityPct}
                                                        onChange={(e) => setAutoCommentProbabilityPct(e.target.value)}
                                                        className="w-20 rounded border border-input bg-transparent px-2 py-1 text-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                                                    />
                                                </div>
                                                <p className="text-[10px] text-muted-foreground max-w-52">
                                                    Requires the wallet to still hold the token — disappears from pump.fun if it later sells. Below 100%, the rate rolls toward the target instead of an independent flip per wallet.
                                                </p>
                                                <BankPicker
                                                    mintAddress={tokenResolved ? tokenMint : undefined}
                                                    selectedBankIds={autoCommentBankIds}
                                                    onChange={setAutoCommentBankIds}
                                                    className="w-64"
                                                />
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

                        {/* Front-Running Protection */}
                        <div className="flex flex-col gap-1.5">
                            <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Front-Running Protection</span>
                            <label className="flex items-center gap-2 cursor-pointer select-none h-9">
                                <input
                                    type="checkbox"
                                    checked={autoHaltEnabled}
                                    onChange={(e) => setAutoHaltEnabled(e.target.checked)}
                                    className="size-4 rounded border border-input accent-blue-500"
                                />
                                <span className="text-xs font-medium text-muted-foreground">Enable</span>
                            </label>
                            {autoHaltEnabled && (
                                <div className="flex flex-col gap-1.5">
                                    <div className="flex items-end gap-3">
                                        <div className="flex flex-col gap-1">
                                            <span className="text-[10px] text-muted-foreground">Trigger after</span>
                                            <div className="flex items-center gap-1.5">
                                                <input
                                                    type="number" min={1} step={1}
                                                    value={haltThreshold}
                                                    onChange={(e) => setHaltThreshold(e.target.value)}
                                                    className="w-16 rounded border border-input bg-transparent px-2 py-1 text-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                                                />
                                                <span className="text-[10px] text-muted-foreground">external trades</span>
                                            </div>
                                        </div>
                                        <div className="flex flex-col gap-1">
                                            <span className="text-[10px] text-muted-foreground">within</span>
                                            <div className="flex items-center gap-1.5">
                                                <input
                                                    type="number" min={1} step={1}
                                                    value={haltWindowSec}
                                                    onChange={(e) => setHaltWindowSec(e.target.value)}
                                                    className="w-16 rounded border border-input bg-transparent px-2 py-1 text-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                                                />
                                                <span className="text-[10px] text-muted-foreground">seconds</span>
                                            </div>
                                        </div>
                                    </div>
                                    <p className="text-[10px] text-muted-foreground max-w-md">
                                        Watches this token&apos;s live trades while the run is active. A trade from a wallet outside this run counts as external — enough of those in the trailing window auto-pauses (not cancels) so you can judge whether it&apos;s a real sniper before resuming or cancelling.
                                    </p>
                                </div>
                            )}
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
                                {tradeType === 'buy' && autoCommentEnabled && (
                                    <div className="flex items-center gap-3 px-4 py-2.5 bg-muted/20">
                                        <span className="w-32 shrink-0 font-medium text-muted-foreground">Auto-Comment</span>
                                        <span className="tabular-nums text-foreground">
                                            {autoCommentDelayMinSec}–{autoCommentDelayMaxSec}s delay, {autoCommentProbabilityPct}% of wallets, {autoCommentBankIds.size} bank{autoCommentBankIds.size !== 1 ? 's' : ''}
                                        </span>
                                    </div>
                                )}
                                {autoHaltEnabled && (
                                    <div className="flex items-center gap-3 px-4 py-2.5 bg-muted/20">
                                        <span className="w-32 shrink-0 font-medium text-muted-foreground">Front-Run Protection</span>
                                        <span className="tabular-nums text-foreground">
                                            auto-pause after {haltThreshold} external trades / {haltWindowSec}s
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

                        {/* Auto-halt alert — distinct from a manual pause */}
                        {haltAlert && (
                            <div role="alert" className="flex gap-3 rounded-lg border border-destructive/50 bg-destructive/10 px-4 py-3 text-destructive">
                                <svg className="mt-0.5 size-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                    <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                                    <line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" />
                                </svg>
                                <div className="flex flex-col gap-1">
                                    <p className="text-xs font-semibold leading-none">Front-running protection triggered</p>
                                    <p className="text-xs text-destructive/80">{haltAlert}</p>
                                </div>
                            </div>
                        )}

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
                                            {(() => {
                                                const amt = formatAmount(execNextWalletId)
                                                return amt ? ` · ${amt}` : ''
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
                                            {(() => {
                                                const amt = formatAmount(execNextWalletId)
                                                return amt ? ` · ${amt}` : ''
                                            })()}
                                        </span>
                                    </div>
                                </div>
                            )
                        )}

                        {/* Sniper-shakeout flush/rebuy — manual sub-flow, independent of
                            the main paused loop. Persists across a pause -> resume ->
                            pause cycle within the same run (only cleared at the start of
                            a new executeAll()), so history reappears if the run pauses
                            again later. */}
                        {execPhase === 'paused' && tradeType === 'buy' && flushCandidates.length > 0 && (
                            <div className="flex flex-col gap-3 rounded-lg border border-border bg-muted/10 p-4">
                                <div className="flex flex-col gap-1">
                                    <span className="text-xs font-semibold text-foreground">Sell &amp; Rebuy (shake out a sniper)</span>
                                    <p className="text-[10px] text-muted-foreground max-w-lg">
                                        Sell a slice of a few already-bought wallets to push the price down, then rebuy them back to
                                        restore their position before hitting Resume. This doesn&apos;t touch or restart the paused
                                        schedule — it only fires extra trades on wallets already marked successful below. Each sell +
                                        rebuy pair costs slippage and fees twice, and isn&apos;t guaranteed to shake out a determined sniper.
                                    </p>
                                </div>

                                <div className="flex items-center gap-2 rounded-lg border border-input bg-transparent px-3 h-9 w-fit focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50 dark:bg-input/30">
                                    <input
                                        type="number" min={1} max={99} step={1} placeholder="50"
                                        value={flushSellPct}
                                        onChange={(e) => setFlushSellPct(e.target.value)}
                                        className="w-16 bg-transparent text-xs outline-none placeholder:text-muted-foreground [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                                    />
                                    <span className="text-xs text-muted-foreground shrink-0">% to sell</span>
                                </div>

                                <div className="flex flex-col gap-1.5">
                                    {flushCandidates.map(({ walletId, wallet, amountSol }) => {
                                        const entry = flushEntries.find((f) => f.walletId === walletId)
                                        return (
                                            <label key={walletId} className="flex items-center gap-2.5 rounded-md border border-border/60 px-2.5 py-1.5 text-xs cursor-pointer">
                                                <input
                                                    type="checkbox"
                                                    checked={flushSelectedIds.has(walletId)}
                                                    onChange={(e) => {
                                                        const next = new Set(flushSelectedIds)
                                                        e.target.checked ? next.add(walletId) : next.delete(walletId)
                                                        setFlushSelectedIds(next)
                                                    }}
                                                    className="size-4 rounded border border-input accent-blue-500"
                                                />
                                                <span className="font-mono flex-1 min-w-0 truncate">
                                                    {wallet?.label && <span className="font-sans font-medium text-foreground">{wallet.label} · </span>}
                                                    {wallet ? maskPubKey(wallet.public_key) : maskPubKey(walletId)}
                                                </span>
                                                <span className="tabular-nums text-green-500 font-medium">{amountSol.toFixed(4)} SOL</span>
                                                <span className="w-24 text-right shrink-0">
                                                    {(!entry || entry.subStatus === 'idle') && <span className="text-muted-foreground/50">—</span>}
                                                    {entry?.subStatus === 'selling'        && <span className="text-blue-500">selling…</span>}
                                                    {entry?.subStatus === 'sold'           && <span className="text-amber-500">sold</span>}
                                                    {entry?.subStatus === 'error-selling'  && <span className="text-destructive" title={entry.error}>sell failed</span>}
                                                    {entry?.subStatus === 'rebuying'       && <span className="text-blue-500">rebuying…</span>}
                                                    {entry?.subStatus === 'rebought'       && <span className="text-green-500">✓ rebought</span>}
                                                    {entry?.subStatus === 'error-rebuying' && <span className="text-destructive" title={entry.error}>rebuy failed</span>}
                                                </span>
                                            </label>
                                        )
                                    })}
                                </div>

                                <div className="flex items-center gap-2">
                                    <button
                                        type="button"
                                        disabled={flushBusy !== null || flushSelectedIds.size === 0 || !flushSellPct || isNaN(parseFloat(flushSellPct))}
                                        onClick={() => sellSelectedForFlush(parseFloat(flushSellPct))}
                                        className="px-3 py-1.5 rounded-lg border border-red-500/60 bg-red-500/10 text-red-500 text-xs font-medium hover:bg-red-500/20 transition-colors disabled:opacity-40 disabled:pointer-events-none"
                                    >
                                        {flushBusy === 'selling' ? 'Selling…' : `Sell ${flushSellPct || 0}% from selected`}
                                    </button>
                                    <button
                                        type="button"
                                        disabled={flushBusy !== null || flushEntries.filter((e) => e.subStatus === 'sold' && flushSelectedIds.has(e.walletId)).length === 0}
                                        onClick={rebuySelectedForFlush}
                                        className="px-3 py-1.5 rounded-lg border border-green-500/60 bg-green-500/10 text-green-500 text-xs font-medium hover:bg-green-500/20 transition-colors disabled:opacity-40 disabled:pointer-events-none"
                                    >
                                        {flushBusy === 'rebuying' ? 'Rebuying…' : 'Rebuy sold wallets back'}
                                    </button>
                                </div>
                            </div>
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

                        {/* Auto-comment activity — comments fire on their own durable
                            schedule well after a buy lands, so this keeps polling
                            regardless of execPhase; not gated on 'running'. */}
                        {autoCommentEnabled && tokenResolved && (
                            <CommentActivityFeed
                                mintAddress={tokenMint}
                                walletIds={selectedWallets}
                                wallets={wallets}
                            />
                        )}
                    </div>
                )}

            </WizardShell>
        </div>
    )
}
