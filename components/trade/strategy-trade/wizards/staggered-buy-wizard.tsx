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
import LaunchTradeFeedPanel from '@/components/tokens/launch/launch-trade-feed-panel'
import { useRelayEvent } from '@/hooks/use-relay-event'
import type { TokenTransactionEvent } from '@/lib/wss/types'
import { isKnownPumpfunSystemWallet } from '@/lib/pumpfun/known-system-wallets'
import { createTradeRun, upsertTradeRunStep, getTradeRun, getTradeRunParams, getTradeRunSteps, requestTradeRunControl, finishTradeRun } from '@/lib/trade/trade-run-client'
import type { StaggeredRunParams } from '@/lib/types/trade-run'

type TradeType  = 'buy' | 'sell'
type ExecPhase  = 'idle' | 'running' | 'paused' | 'done' | 'cancelled'
type ExecStatus = 'pending' | 'executing' | 'success' | 'error' | 'cancelled' | 'retrying'

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

export default function StaggeredBuyWizard({ resumeRunId }: { resumeRunId?: string }) {
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

    // MEV protection — submits each wallet's OWN buy as its own solo Jito
    // bundle (its own tip, its own transaction) instead of a plain
    // sendTransaction, so nothing can see it and react before it lands.
    // Deliberately still one wallet per bundle: bundling MULTIPLE wallets
    // together is what actually produces the "bundled wallets" signature
    // screeners flag — a solo bundle, staggered in time like every other
    // trade in this run, doesn't create that co-occurrence signature.
    const [useJitoBuy, setUseJitoBuy] = useState(false)
    const [jitoTipSol, setJitoTipSol] = useState('0.0005')

    // Test mode — every trade call gets dryRun:true, same convention as
    // Launch Builder's testMode. The route still does everything except
    // broadcast: real bonding-curve reads, real quote math, a real signed
    // (but simulated, not sent) transaction — so schedule building,
    // interleaving, pause/resume, front-run auto-halt (a real relay
    // subscription against the real mint), and the flush/rebuy panel all
    // exercise exactly as they would live, without spending real SOL or
    // moving real supply. Defaults on, matching Launch Builder's own default.
    const [testMode, setTestMode] = useState(true)

    // Schedule (generated once when leaving Parameters step)
    const [schedule, setSchedule] = useState<ScheduleEntry[]>([])

    // executeAll() is one long-running async closure started by a single
    // button click — its references to `slippage`/`schedule` are captured
    // from THAT render and stay stale for the closure's whole lifetime, so a
    // later setSlippage()/setSchedule() (e.g. from the paused-state "Adjust
    // Run" panel below) would silently never reach the in-flight loop
    // without these. Kept in sync via the effect further down; the loop
    // reads .current instead of the state variable directly.
    const slippageRef = useRef(slippage)
    const scheduleRef = useRef<ScheduleEntry[]>(schedule)

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
    // Separate selection sets for the Sell and Rebuy sections — sharing one
    // set used to mean re-checking a wallet to sell MORE later would also
    // re-include every already-sold wallet still checked from the first
    // wave, silently re-selling them on the next "Sell" click. Splitting
    // these means the two sections can't step on each other: selecting more
    // sell targets never touches which sold wallets are queued for rebuy.
    const [flushSellSelectedIds, setFlushSellSelectedIds]   = useState<Set<string>>(new Set())
    const [flushRebuySelectedIds, setFlushRebuySelectedIds] = useState<Set<string>>(new Set())
    const [flushSellPct, setFlushSellPct]         = useState('50')
    // Own slippage, deliberately separate from the run's slippage (see
    // slippageRef) and defaulted looser — a flush-sell intentionally craters
    // the price to shake out a sniper, so the rebuy immediately after faces
    // far more price movement than the run's steady-state trades ever did.
    // Reusing the run's normal (often tight) slippage for the rebuy was
    // exactly why "lots of rebuys fail": it was never sized for buying back
    // through a dip this sub-flow itself just caused.
    const [flushSlippage, setFlushSlippage]       = useState('10')
    const [flushEntries, setFlushEntries]         = useState<FlushEntry[]>([])
    const [flushBusy, setFlushBusy]               = useState<'selling' | 'rebuying' | null>(null)

    // Per-wallet slippage override for retrying a single failed trade — keyed
    // by walletId, percent string (e.g. "8" for 8%). Blank means "use the
    // run's current slippage" (slippageRef.current, itself live-adjustable
    // via the Adjust Run panel). Retrying fires its own independent fetch,
    // deliberately NOT routed through executeAll()'s loop or pauseRef/
    // abortRef — the whole point is retrying one wallet shouldn't require
    // pausing (or even affect) every other wallet still mid-run.
    const [retrySlippage, setRetrySlippage] = useState<Record<string, string>>({})

    // Run-scoped, non-rendered state for the auto-halt detector — mutated
    // directly by executeAll(), read by the relay-event handler below.
    const autoHaltActiveRef        = useRef(false)
    const runWalletKeysRef         = useRef<Set<string>>(new Set())
    const foreignTradeTimestampsRef = useRef<number[]>([])

    useEffect(() => { slippageRef.current = slippage }, [slippage])
    useEffect(() => { scheduleRef.current = schedule }, [schedule])

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
        // Pump.fun's own fee/system authority buys and sells for protocol
        // maintenance, not real trading — without this it reads as a sniper
        // and trips the auto-halt on every run. See known-system-wallets.ts.
        if (isKnownPumpfunSystemWallet(e.wallet)) return

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

    // For LaunchTradeFeedPanel's "OURS" tag — every platform wallet, not just
    // this run's schedule (runWalletKeysRef above is deliberately narrower,
    // scoped to auto-halt's own foreign-trade detection). Same convention as
    // app/protected/tokens/live-trades/page.tsx.
    const ourWallets = useMemo(() => new Set(wallets.map((w) => w.public_key)), [wallets])
    const ourWalletLabels = useMemo(() => {
        const map: Record<string, string> = {}
        for (const w of wallets) if (w.label) map[w.public_key] = w.label
        return map
    }, [wallets])

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

    // Reconstructs a lost run's parameters from the DB (see the `params`
    // column added to trade_runs and get_trade_run_params()) so a dead tab
    // doesn't mean rebuilding the whole run by hand. Only fires once
    // wallets have loaded — tradeAmounts/schedule reference wallet ids the
    // Execute step's own render needs resolved against `wallets`.
    const [resumeStatus, setResumeStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>(resumeRunId ? 'loading' : 'idle')
    const [resumeError, setResumeError]   = useState<string | null>(null)
    const [resumeBanner, setResumeBanner] = useState<{ completed: number; total: number } | null>(null)
    const resumeAttemptedRef = useRef(false)

    useEffect(() => {
        if (!resumeRunId || resumeAttemptedRef.current || wallets.length === 0) return
        resumeAttemptedRef.current = true

        ;(async () => {
            const [run, params, steps] = await Promise.all([
                getTradeRun(resumeRunId),
                getTradeRunParams(resumeRunId),
                getTradeRunSteps(resumeRunId),
            ])

            if (!run || !params) {
                setResumeStatus('error')
                setResumeError('Could not load this run to resume — it may have been deleted, or it predates saved run parameters.')
                return
            }

            const p = params as unknown as StaggeredRunParams

            setTradeType(p.tradeType)
            setTokenMint(p.tokenMint)
            setTokenResolved(true)
            setTokenName(p.tokenName)
            setTokenSymbol(p.tokenSymbol)
            setTokenDecimals(p.tokenDecimals)
            setSelectedWallets(new Set(p.schedule.map((e) => e.walletId)))
            setTradeAmounts(p.tradeAmounts)
            setSlippage(p.slippage)
            setSellPct(p.sellPct)
            setUseJitoBuy(p.useJitoBuy)
            setJitoTipSol(p.jitoTipSol)
            setAutoCommentEnabled(p.autoCommentEnabled)
            setAutoCommentDelayMinSec(p.autoCommentDelayMinSec)
            setAutoCommentDelayMaxSec(p.autoCommentDelayMaxSec)
            setAutoCommentProbabilityPct(p.autoCommentProbabilityPct)
            setAutoCommentBankIds(new Set(p.autoCommentBankIds))
            setAutoHaltEnabled(p.autoHaltEnabled)
            setHaltThreshold(p.haltThreshold)
            setHaltWindowSec(p.haltWindowSec)
            setTestMode(p.testMode)

            // Only a confirmed 'success' counts as already done — a step
            // left 'error'/'cancelled'/'running' is ambiguous about whether
            // the trade actually landed (e.g. the response never made it
            // back before the tab died), so it's retried rather than
            // silently skipped. That can double-fire an already-landed
            // trade for that one wallet; the safer of two bad options.
            const successIds = new Set(
                steps.filter((s) => s.status === 'success').map((s) => s.step_key)
            )
            const remaining = p.schedule.filter((e) => !successIds.has(e.walletId))

            setSchedule(remaining)
            setExecState(remaining.map((e) => ({ walletId: e.walletId, status: 'pending' as const })))
            runIdRef.current = resumeRunId
            setResumeBanner({ completed: successIds.size, total: p.schedule.length })
            setResumeStatus('ready')
            setStep(3)
        })()
    }, [resumeRunId, wallets])

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

    // The full run plan, captured once when a brand-new run kicks off (see
    // the `!runIdRef.current` guard in executeAll()) and saved to
    // trade_runs.params — what a resumed tab reconstructs its state from.
    function buildRunParams(): StaggeredRunParams {
        return {
            tradeType,
            tokenMint,
            tokenName,
            tokenSymbol,
            tokenDecimals,
            schedule,
            tradeAmounts,
            slippage,
            sellPct,
            useJitoBuy,
            jitoTipSol,
            autoCommentEnabled,
            autoCommentDelayMinSec,
            autoCommentDelayMaxSec,
            autoCommentProbabilityPct,
            autoCommentBankIds: [...autoCommentBankIds],
            autoHaltEnabled,
            haltThreshold,
            haltWindowSec,
            testMode,
        }
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

    // Re-rolls delayMsAfter (within the CURRENT delayMin/delayMax, which the
    // Adjust Run panel just edited) for every trade that hasn't fired yet —
    // identified via execState, not array position, since that's the only
    // reliable "not yet executed" signal once a run is underway. Trades that
    // already landed (or are the one about to fire when this returns) keep
    // whatever delay they were already assigned; only genuinely future ones
    // change. Safe to call from the paused-state panel: executeAll() reads
    // scheduleRef.current, so this takes effect the moment the run resumes.
    function applyDelayRangeToRemaining() {
        const delay = validDelayRange()
        if (!delay) return
        const pendingWalletIds = new Set(
            execState.filter((s) => s.status === 'pending').map((s) => s.walletId)
        )
        setSchedule((prev) => prev.map((entry, i) => {
            if (!pendingWalletIds.has(entry.walletId)) return entry
            const isLast = i === prev.length - 1
            return {
                ...entry,
                delayMsAfter: isLast ? 0 : Math.round(Math.random() * (delay.maxMs - delay.minMs) + delay.minMs),
            }
        }))
    }

    // Retries ONE failed wallet's trade in place — independent of executeAll()'s
    // main loop, so it can fire while other wallets are still executing (no
    // pause needed) and can't collide with them: a wallet only ever shows
    // 'error' after the main loop has already moved past its index for good,
    // so the loop will never revisit it concurrently with this. Usually
    // exactly the scenario the user's describing — another trade landed
    // around this wallet's attempt and pushed it past its slippage tolerance —
    // so this takes an optional per-wallet slippage override instead of
    // forcing a pause to retune the whole run's slippage for one retry.
    async function retryTrade(walletId: string) {
        if (execState.find((s) => s.walletId === walletId)?.status === 'retrying') return

        const overridePct   = parseFloat(retrySlippage[walletId] ?? '')
        const slippageToUse = !isNaN(overridePct) && overridePct > 0 ? overridePct / 100 : slippageRef.current

        setExecState((prev) => prev.map((s) => s.walletId === walletId ? { ...s, status: 'retrying', error: undefined } : s))
        upsertTradeRunStep(runIdRef.current, { stepKey: walletId, walletId, status: 'running', amount: formatAmount(walletId) })

        try {
            let apiResult: { success: boolean; signature?: string; error?: string }

            if (tradeType === 'buy') {
                const solAmt   = tradeAmounts[walletId] ?? '0'
                const lamports = Math.round(parseFloat(solAmt) * 1_000_000_000).toString()
                const res = await fetch('/api/trade/staggered/buy', {
                    method:  'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body:    JSON.stringify({
                        walletId,
                        mintAddress: tokenMint,
                        solAmountLamports: lamports,
                        slippage: slippageToUse,
                        dryRun: testMode,
                        ...(useJitoBuy ? {
                            useJito: true,
                            jitoTipLamports: Math.round((parseFloat(jitoTipSol) || 0) * 1_000_000_000).toString(),
                        } : {}),
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
                const tokenAmt = tradeAmounts[walletId] ?? '0'
                const pct      = parseFloat(sellPct)
                const res = await fetch('/api/trade/staggered/sell', {
                    method:  'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body:    JSON.stringify({ walletId, mintAddress: tokenMint, tokenAmount: tokenAmt, slippage: slippageToUse, sellPct: isNaN(pct) ? undefined : pct, dryRun: testMode }),
                })
                apiResult = await res.json()
            }

            setExecState((prev) => prev.map((s) =>
                s.walletId === walletId
                    ? { ...s, status: apiResult.success ? 'success' : 'error', signature: apiResult.signature, error: apiResult.error }
                    : s
            ))
            upsertTradeRunStep(runIdRef.current, {
                stepKey: walletId, walletId,
                status: apiResult.success ? 'success' : 'error',
                amount: formatAmount(walletId), signature: apiResult.signature, error: apiResult.error,
            })
            if (apiResult.success) {
                setRetrySlippage((prev) => {
                    const { [walletId]: _drop, ...rest } = prev
                    return rest
                })
            }
        } catch (err) {
            const message = err instanceof Error ? err.message : 'Network error'
            setExecState((prev) => prev.map((s) => s.walletId === walletId ? { ...s, status: 'error', error: message } : s))
            upsertTradeRunStep(runIdRef.current, { stepKey: walletId, walletId, status: 'error', amount: formatAmount(walletId), error: message })
        }
    }

    async function executeAll() {
        abortRef.current = false
        pauseRef.current = false
        setHaltAlert(null)
        setExecPhase('running')
        setExecState(schedule.map((e) => ({ walletId: e.walletId, status: 'pending' })))
        setFlushEntries([])
        setFlushSellSelectedIds(new Set())
        setFlushRebuySelectedIds(new Set())

        // Skipped when resuming — runIdRef.current is already set to the
        // existing run's id (see the resume effect above), and reusing it
        // is what keeps the Control Center showing one continuous run
        // instead of a duplicate. params.schedule on that row stays the
        // pristine original plan forever, since this only ever runs once
        // per row.
        if (!runIdRef.current) {
            runIdRef.current = await createTradeRun(
                tradeType === 'buy' ? 'staggered_buy' : 'staggered_sell',
                tokenMint,
                tokenSymbol || tokenName || null,
                schedule.length,
                buildRunParams() as unknown as Record<string, unknown>,
            )
        }

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

            // .current, not the closed-over schedule — so a delay-range edit
            // made in the paused-state Adjust Run panel below is visible to
            // THIS iteration the moment it resumes, not just to future runs.
            const entry = scheduleRef.current[i]

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
                            slippage: slippageRef.current,
                            dryRun: testMode,
                            ...(useJitoBuy ? {
                                useJito: true,
                                jitoTipLamports: Math.round((parseFloat(jitoTipSol) || 0) * 1_000_000_000).toString(),
                            } : {}),
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
                        body: JSON.stringify({ walletId: entry.walletId, mintAddress: tokenMint, tokenAmount: tokenAmt, slippage: slippageRef.current, sellPct: isNaN(pct) ? undefined : pct, dryRun: testMode }),
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
                setExecNextWalletId(scheduleRef.current[i + 1].walletId)
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
        const ids  = [...flushSellSelectedIds]
        const slip = (parseFloat(flushSlippage) || 10) / 100
        setFlushBusy('selling')
        for (let i = 0; i < ids.length; i++) {
            const walletId = ids[i]
            setFlushEntries((prev) => [...prev.filter((e) => e.walletId !== walletId), { walletId, subStatus: 'selling' }])
            try {
                const res = await fetch('/api/trade/staggered/sell', {
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ walletId, mintAddress: tokenMint, slippage: slip, sellPct: pct, dryRun: testMode }),
                })
                const result = await res.json()
                setFlushEntries((prev) => prev.map((e) => e.walletId === walletId
                    ? { ...e, subStatus: result.success ? 'sold' : 'error-selling', sellSignature: result.signature, error: result.error } : e))
                upsertTradeRunStep(runIdRef.current, {
                    stepKey: `${walletId}:flush-sell`, walletId,
                    status: result.success ? 'success' : 'error',
                    amount: `${pct}% flush-sell`, signature: result.signature, error: result.error,
                })
                if (result.success) {
                    // Moves it out of Sell (so it can't be accidentally re-sold
                    // on the next wave) and into Rebuy, pre-selected there.
                    setFlushSellSelectedIds((prev) => {
                        const next = new Set(prev)
                        next.delete(walletId)
                        return next
                    })
                    setFlushRebuySelectedIds((prev) => new Set(prev).add(walletId))
                }
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
        const ids  = flushEntries
            .filter((e) => (e.subStatus === 'sold' || e.subStatus === 'error-rebuying') && flushRebuySelectedIds.has(e.walletId))
            .map((e) => e.walletId)
        const slip = (parseFloat(flushSlippage) || 10) / 100
        setFlushBusy('rebuying')
        for (let i = 0; i < ids.length; i++) {
            const walletId = ids[i]
            setFlushEntries((prev) => prev.map((e) => e.walletId === walletId ? { ...e, subStatus: 'rebuying' } : e))
            try {
                const solAmt   = tradeAmounts[walletId] ?? '0'   // original buy amount — restores full position
                const lamports = Math.round(parseFloat(solAmt) * 1_000_000_000).toString()
                const res = await fetch('/api/trade/staggered/buy', {
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ walletId, mintAddress: tokenMint, solAmountLamports: lamports, slippage: slip, dryRun: testMode }),
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

    // Splits flushCandidates by where each wallet is in the flush lifecycle —
    // a wallet "moves" from Sell to Rebuy the moment its sell succeeds (and
    // stays in Rebuy afterward even if the rebuy itself later fails; retrying
    // that lives in the Rebuy section, not back in Sell). This is what keeps
    // the two actions from interfering: selecting more not-yet-sold wallets
    // to sell further never touches which already-sold wallets are queued to
    // rebuy, and vice versa.
    const flushSellCandidates = useMemo(() => {
        return flushCandidates.filter(({ walletId }) => {
            const entry = flushEntries.find((f) => f.walletId === walletId)
            return !entry || entry.subStatus === 'idle' || entry.subStatus === 'selling' || entry.subStatus === 'error-selling'
        })
    }, [flushCandidates, flushEntries])

    const flushRebuyCandidates = useMemo(() => {
        return flushCandidates.filter(({ walletId }) => {
            const entry = flushEntries.find((f) => f.walletId === walletId)
            return !!entry && (entry.subStatus === 'sold' || entry.subStatus === 'rebuying' || entry.subStatus === 'rebought' || entry.subStatus === 'error-rebuying')
        })
    }, [flushCandidates, flushEntries])

    // ─────────────────────────────────────────────────────────────────────────

    return (
        <div className="flex flex-col gap-4">
            <p className="text-xs text-muted-foreground">
                Spread {tradeType === 'buy' ? 'buys' : 'sells'} across wallets with randomized delays between each trade to simulate organic human behavior.
            </p>

            {resumeStatus === 'error' && (
                <div className="flex items-center gap-2 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs font-medium text-destructive">
                    <span className="inline-block size-2 rounded-full bg-destructive shrink-0" />
                    {resumeError}
                </div>
            )}

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

                        {/* Test Mode */}
                        <div className="flex flex-col gap-1.5">
                            <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Test Mode</span>
                            <label className="flex items-center gap-2 cursor-pointer select-none h-9">
                                <input
                                    type="checkbox"
                                    checked={testMode}
                                    onChange={(e) => setTestMode(e.target.checked)}
                                    className="size-4 rounded border border-input accent-amber-500"
                                />
                                <span className="text-xs font-medium text-muted-foreground">Enable</span>
                            </label>
                            <p className="text-[10px] text-muted-foreground max-w-md">
                                Every trade (including Sell &amp; Rebuy) runs against a real, previously-launched token — real bonding-curve reads
                                and quotes, real front-run detection — but the transaction is only simulated, never broadcast. Nothing is spent
                                and no supply moves. Turn off to run for real.
                            </p>
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

                        {/* MEV Protection (Jito) — buy-side only */}
                        {tradeType === 'buy' && (
                            <div className="flex flex-col gap-1.5">
                                <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">MEV Protection (Jito)</span>
                                <label className="flex items-center gap-2 cursor-pointer select-none h-9">
                                    <input
                                        type="checkbox"
                                        checked={useJitoBuy}
                                        onChange={(e) => setUseJitoBuy(e.target.checked)}
                                        className="size-4 rounded border border-input accent-blue-500"
                                    />
                                    <span className="text-xs font-medium text-muted-foreground">Enable</span>
                                </label>
                                {useJitoBuy && (
                                    <div className="flex flex-col gap-1.5">
                                        <div className="flex items-center gap-2 rounded-lg border border-input bg-transparent px-3 h-9 w-fit focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50 dark:bg-input/30">
                                            <input
                                                type="number" min={0} step={0.0001} placeholder="0.0005"
                                                value={jitoTipSol}
                                                onChange={(e) => setJitoTipSol(e.target.value)}
                                                className="w-24 bg-transparent text-xs outline-none placeholder:text-muted-foreground [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                                            />
                                            <span className="text-xs text-muted-foreground shrink-0">SOL tip per wallet</span>
                                        </div>
                                        <p className="text-[10px] text-muted-foreground max-w-md">
                                            Each wallet&apos;s buy submits as its own solo Jito bundle instead of a plain send — bypasses the
                                            point where a sandwich bot could see it and react before it lands. Adds the tip above on top of
                                            every buy. Still one wallet per bundle, staggered in time like the rest of the run — this doesn&apos;t
                                            create the multi-wallet &quot;bundled&quot; signature screeners look for.
                                        </p>
                                    </div>
                                )}
                            </div>
                        )}

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
                            slippage={slippage}
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
                                {testMode && (
                                    <div className="flex items-center gap-3 px-4 py-2.5 bg-amber-500/10">
                                        <span className="w-32 shrink-0 font-medium text-amber-600 dark:text-amber-400">Test Mode</span>
                                        <span className="text-amber-600 dark:text-amber-400">Enabled — trades will be simulated, not broadcast</span>
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

                        {resumeBanner && (
                            <div className="flex items-center gap-2 rounded-lg border border-blue-500/40 bg-blue-500/10 px-3 py-2 text-xs font-medium text-blue-600 dark:text-blue-400">
                                <span className="inline-block size-2 rounded-full bg-blue-500 shrink-0" />
                                Resuming — {resumeBanner.completed} of {resumeBanner.total} steps already completed, {resumeBanner.total - resumeBanner.completed} remaining. Review the plan below, then Start Execution to continue.
                            </div>
                        )}

                        {testMode && (
                            <div className="flex items-center gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs font-medium text-amber-600 dark:text-amber-400">
                                <span className="inline-block size-2 rounded-full bg-amber-500 shrink-0" />
                                TEST MODE — trades are simulated, nothing is broadcast or spent.
                            </div>
                        )}

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

                        {/* Adjust Run — lets you retune slippage, pacing, and front-running
                            sensitivity mid-run without cancelling. Slippage and auto-halt
                            fields are plain state the loop/relay-handler already read live
                            (via slippageRef / handlerRef-forwarding); only the delay range
                            needs an explicit "Apply" since it's baked into each remaining
                            schedule entry rather than read fresh per-trade. */}
                        {execPhase === 'paused' && (
                            <div className="flex flex-col gap-4 rounded-lg border border-blue-500/20 bg-blue-500/5 p-4">
                                <span className="text-xs font-semibold text-foreground">Adjust Run</span>
                                <p className="text-[10px] text-muted-foreground -mt-2">
                                    Changes apply to trades that haven&apos;t fired yet — nothing already executed is affected.
                                </p>

                                <div className="flex flex-wrap items-start gap-8">
                                    <div className="flex flex-col gap-1.5 min-w-48">
                                        <SlippageControl value={slippage} onChange={setSlippage} />
                                    </div>

                                    <div className="flex flex-col gap-1.5">
                                        <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Delay Between Trades</span>
                                        <div className="flex items-end gap-2">
                                            <div className="flex flex-col gap-1">
                                                <span className="text-[10px] text-muted-foreground">Min (seconds)</span>
                                                <input
                                                    type="number" min={0} step={1} placeholder="5"
                                                    value={delayMin}
                                                    onChange={(e) => setDelayMin(e.target.value)}
                                                    className="w-20 rounded border border-input bg-transparent px-2 py-1 text-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                                                />
                                            </div>
                                            <span className="text-muted-foreground text-sm mb-1.5">–</span>
                                            <div className="flex flex-col gap-1">
                                                <span className="text-[10px] text-muted-foreground">Max (seconds)</span>
                                                <input
                                                    type="number" min={0} step={1} placeholder="30"
                                                    value={delayMax}
                                                    onChange={(e) => setDelayMax(e.target.value)}
                                                    className="w-20 rounded border border-input bg-transparent px-2 py-1 text-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                                                />
                                            </div>
                                            <button
                                                type="button"
                                                onClick={applyDelayRangeToRemaining}
                                                disabled={!validDelayRange()}
                                                className="mb-0.5 px-3 py-1.5 rounded-lg border border-blue-500/60 bg-blue-500/10 text-blue-500 text-xs font-medium hover:bg-blue-500/20 transition-colors disabled:opacity-40 disabled:pointer-events-none"
                                            >
                                                Apply to Remaining
                                            </button>
                                        </div>
                                    </div>

                                    {autoHaltEnabled && (
                                        <div className="flex flex-col gap-1.5">
                                            <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Front-Running Sensitivity</span>
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
                                                        <span className="text-[10px] text-muted-foreground">trades</span>
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
                                            <p className="text-[10px] text-muted-foreground">Takes effect immediately — no Apply needed.</p>
                                        </div>
                                    )}
                                </div>
                            </div>
                        )}

                        {/* Sniper-shakeout flush/rebuy — manual sub-flow, independent of
                            the main paused loop. Persists across a pause -> resume ->
                            pause cycle within the same run (only cleared at the start of
                            a new executeAll()), so history reappears if the run pauses
                            again later. */}
                        {execPhase === 'paused' && tradeType === 'buy' && flushCandidates.length > 0 && (
                            <div className="flex flex-col gap-4 rounded-lg border border-border bg-muted/10 p-4">
                                <div className="flex flex-col gap-1">
                                    <span className="text-xs font-semibold text-foreground">Sell &amp; Rebuy (shake out a sniper)</span>
                                    <p className="text-[10px] text-muted-foreground max-w-lg">
                                        Sell a slice of a few already-bought wallets to push the price down, then rebuy them back to
                                        restore their position before hitting Resume. This doesn&apos;t touch or restart the paused
                                        schedule — it only fires extra trades on wallets already marked successful below. A sold wallet
                                        moves into Rebuy below once its sell lands, so you can keep selecting more wallets to sell here
                                        without it re-selling anything already sold. Each sell + rebuy pair costs slippage and fees
                                        twice, and isn&apos;t guaranteed to shake out a determined sniper. The SOL amount shown per
                                        wallet is what it originally bought with, not a token balance — the sell itself always resolves
                                        against each wallet&apos;s real, live on-chain token balance.
                                    </p>
                                    {testMode && (
                                        <p className="text-[10px] text-amber-600 dark:text-amber-400 max-w-lg">
                                            Test Mode is on — the original buys were simulated, never broadcast, so these wallets hold
                                            zero real tokens on-chain. Every sell here will fail with &quot;no token balance to sell&quot;
                                            until tested against a wallet that actually holds tokens from a real (non-dry-run) buy.
                                        </p>
                                    )}
                                </div>

                                {/* Own slippage — separate from the run's, and looser by default.
                                    A flush-sell deliberately craters the price; the rebuy right after
                                    needs room for that self-inflicted move, not the run's steady-state
                                    tolerance. This was the actual cause of "lots of rebuys fail". */}
                                <div className="flex items-center gap-2 rounded-lg border border-input bg-transparent px-3 h-9 w-fit focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50 dark:bg-input/30">
                                    <input
                                        type="number" min={0.1} max={50} step={0.5} placeholder="10"
                                        value={flushSlippage}
                                        onChange={(e) => setFlushSlippage(e.target.value)}
                                        title="Slippage for both the flush-sell and the rebuy — separate from the run's own slippage"
                                        className="w-16 bg-transparent text-xs outline-none placeholder:text-muted-foreground [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                                    />
                                    <span className="text-xs text-muted-foreground shrink-0">% flush slippage (sell &amp; rebuy)</span>
                                </div>

                                {/* ── Sell ─────────────────────────────────────────────── */}
                                <div className="flex flex-col gap-2 rounded-md border border-red-500/20 bg-red-500/5 p-3">
                                    <span className="text-[11px] font-semibold uppercase tracking-wider text-red-500">Sell</span>

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
                                        {flushSellCandidates.length === 0 && (
                                            <p className="text-[10px] text-muted-foreground/70 py-1">
                                                Nothing left to sell — every wallet below has already been sold.
                                            </p>
                                        )}
                                        {flushSellCandidates.map(({ walletId, wallet, amountSol }) => {
                                            const entry = flushEntries.find((f) => f.walletId === walletId)
                                            return (
                                                <label key={walletId} className="flex items-center gap-2.5 rounded-md border border-border/60 bg-background/50 px-2.5 py-1.5 text-xs cursor-pointer">
                                                    <input
                                                        type="checkbox"
                                                        checked={flushSellSelectedIds.has(walletId)}
                                                        onChange={(e) => {
                                                            const next = new Set(flushSellSelectedIds)
                                                            e.target.checked ? next.add(walletId) : next.delete(walletId)
                                                            setFlushSellSelectedIds(next)
                                                        }}
                                                        className="size-4 rounded border border-input accent-red-500"
                                                    />
                                                    <span className="font-mono flex-1 min-w-0 truncate">
                                                        {wallet?.label && <span className="font-sans font-medium text-foreground">{wallet.label} · </span>}
                                                        {wallet ? maskPubKey(wallet.public_key) : maskPubKey(walletId)}
                                                    </span>
                                                    <span className="tabular-nums text-green-500 font-medium">{amountSol.toFixed(4)} SOL</span>
                                                    <span className="w-20 text-right shrink-0">
                                                        {(!entry || entry.subStatus === 'idle') && <span className="text-muted-foreground/50">—</span>}
                                                        {entry?.subStatus === 'selling'       && <span className="text-blue-500">selling…</span>}
                                                        {entry?.subStatus === 'error-selling' && <span className="text-destructive" title={entry.error}>failed</span>}
                                                    </span>
                                                </label>
                                            )
                                        })}
                                    </div>

                                    <button
                                        type="button"
                                        disabled={flushBusy !== null || flushSellSelectedIds.size === 0 || !flushSellPct || isNaN(parseFloat(flushSellPct))}
                                        onClick={() => sellSelectedForFlush(parseFloat(flushSellPct))}
                                        className="self-start px-3 py-1.5 rounded-lg border border-red-500/60 bg-red-500/10 text-red-500 text-xs font-medium hover:bg-red-500/20 transition-colors disabled:opacity-40 disabled:pointer-events-none"
                                    >
                                        {flushBusy === 'selling' ? 'Selling…' : `Sell ${flushSellPct || 0}% from selected`}
                                    </button>
                                </div>

                                {/* ── Rebuy ────────────────────────────────────────────── */}
                                <div className="flex flex-col gap-2 rounded-md border border-green-500/20 bg-green-500/5 p-3">
                                    <span className="text-[11px] font-semibold uppercase tracking-wider text-green-500">Rebuy</span>

                                    <div className="flex flex-col gap-1.5">
                                        {flushRebuyCandidates.length === 0 && (
                                            <p className="text-[10px] text-muted-foreground/70 py-1">
                                                Nothing here yet — sell something above first.
                                            </p>
                                        )}
                                        {flushRebuyCandidates.map(({ walletId, wallet, amountSol }) => {
                                            const entry = flushEntries.find((f) => f.walletId === walletId)
                                            return (
                                                <label key={walletId} className="flex items-center gap-2.5 rounded-md border border-border/60 bg-background/50 px-2.5 py-1.5 text-xs cursor-pointer">
                                                    <input
                                                        type="checkbox"
                                                        checked={flushRebuySelectedIds.has(walletId)}
                                                        disabled={entry?.subStatus !== 'sold' && entry?.subStatus !== 'error-rebuying'}
                                                        onChange={(e) => {
                                                            const next = new Set(flushRebuySelectedIds)
                                                            e.target.checked ? next.add(walletId) : next.delete(walletId)
                                                            setFlushRebuySelectedIds(next)
                                                        }}
                                                        className="size-4 rounded border border-input accent-green-500 disabled:opacity-40"
                                                    />
                                                    <span className="font-mono flex-1 min-w-0 truncate">
                                                        {wallet?.label && <span className="font-sans font-medium text-foreground">{wallet.label} · </span>}
                                                        {wallet ? maskPubKey(wallet.public_key) : maskPubKey(walletId)}
                                                    </span>
                                                    <span className="tabular-nums text-green-500 font-medium">{amountSol.toFixed(4)} SOL</span>
                                                    <span className="w-24 text-right shrink-0">
                                                        {entry?.subStatus === 'sold'           && <span className="text-amber-500">sold</span>}
                                                        {entry?.subStatus === 'rebuying'       && <span className="text-blue-500">rebuying…</span>}
                                                        {entry?.subStatus === 'rebought'       && <span className="text-green-500">✓ rebought</span>}
                                                        {entry?.subStatus === 'error-rebuying' && <span className="text-destructive" title={entry.error}>rebuy failed</span>}
                                                    </span>
                                                </label>
                                            )
                                        })}
                                    </div>

                                    <button
                                        type="button"
                                        disabled={flushBusy !== null || flushEntries.filter((e) => (e.subStatus === 'sold' || e.subStatus === 'error-rebuying') && flushRebuySelectedIds.has(e.walletId)).length === 0}
                                        onClick={rebuySelectedForFlush}
                                        className="self-start px-3 py-1.5 rounded-lg border border-green-500/60 bg-green-500/10 text-green-500 text-xs font-medium hover:bg-green-500/20 transition-colors disabled:opacity-40 disabled:pointer-events-none"
                                    >
                                        {flushBusy === 'rebuying' ? 'Rebuying…' : 'Rebuy selected'}
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
                                                        entry.status === 'retrying'  ? 'bg-blue-500/5' :
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
                                                        {(entry.status === 'executing' || entry.status === 'retrying') && (
                                                            <span className="flex items-center justify-end gap-1.5 text-blue-500">
                                                                <span className="inline-block size-3 rounded-full border-2 border-blue-300 border-t-blue-500 animate-spin" />
                                                                {entry.status === 'retrying' ? 'retrying' : 'executing'}
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
                                                            <div className="flex flex-col items-end gap-1.5 py-0.5">
                                                                <span className="text-destructive" title={entry.error}>
                                                                    ✗ {(entry.error ?? 'failed').slice(0, 40)}
                                                                </span>
                                                                <div className="flex items-center gap-1">
                                                                    <input
                                                                        type="number" min={0.1} max={50} step={0.1}
                                                                        placeholder={(slippage * 100).toFixed(1)}
                                                                        value={retrySlippage[entry.walletId] ?? ''}
                                                                        onChange={(e) => setRetrySlippage((prev) => ({ ...prev, [entry.walletId]: e.target.value }))}
                                                                        title="Slippage % for this retry only — blank uses the run's current slippage"
                                                                        className="w-14 rounded border border-input bg-transparent px-1.5 py-1 text-right text-[10px] outline-none focus-visible:ring-1 focus-visible:ring-ring [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                                                                    />
                                                                    <span className="text-[10px] text-muted-foreground">%</span>
                                                                    <button
                                                                        type="button"
                                                                        onClick={() => retryTrade(entry.walletId)}
                                                                        className="rounded border border-blue-500/60 bg-blue-500/10 px-2 py-1 text-[10px] font-medium text-blue-500 hover:bg-blue-500/20 transition-colors"
                                                                    >
                                                                        Retry
                                                                    </button>
                                                                </div>
                                                            </div>
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

            {/* Same live trade feed as the Launch Builder and standalone Live
                Trades page — every trade on this mint, not just ours, so a
                sniper shows up here in real time during execution. */}
            {step === 2 && tokenMint && (
                <LaunchTradeFeedPanel
                    mintAddress={tokenMint}
                    tokenSymbol={tokenSymbol || tokenName || null}
                    ourWallets={ourWallets}
                    ourWalletLabels={ourWalletLabels}
                />
            )}
        </div>
    )
}
