'use client'

import { useState, useMemo, useEffect } from 'react'
import BN from 'bn.js'
import WizardShell, { WizardStep } from './wizard-shell'
import StrategyWalletSelector from '@/components/trade/strategy-trade/strategy-wallet-selector'
import { solStringToLamports, lamportsBNToSolDisplay, lamportsStringToBN } from '@/lib/lamports'
import { WalletRecord } from '@/lib/types/wallet'
import { SlippageControl } from '@/components/trade/trade/SlippageControl'
import { TokenMintInput } from '@/components/trade/strategy-trade/TokenMintInput'
import BankPicker from '@/components/tokens/comment-bank/bank-picker'

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

type TradeType = 'buy' | 'sell'
type TipMode    = 'fixed' | 'floor'
type FloorKey   = 'p25' | 'p50' | 'p75' | 'p95' | 'p99' | 'ema50'

type TipFloorData = { p25: number; p50: number; p75: number; p95: number; p99: number; ema50: number }

const FLOOR_OPTIONS: { key: FloorKey; label: string }[] = [
    { key: 'p25',   label: '25th'  },
    { key: 'p50',   label: '50th'  },
    { key: 'p75',   label: '75th'  },
    { key: 'p95',   label: '95th'  },
    { key: 'p99',   label: '99th'  },
    { key: 'ema50', label: 'EMA 50' },
]

function formatTokenAmount(raw: string, decimals: number): string {
    if (!raw || raw === '0') return '0'
    const padded = raw.padStart(decimals + 1, '0')
    const intPart = padded.slice(0, padded.length - decimals) || '0'
    const fracPart = padded.slice(padded.length - decimals)
    return `${intPart}.${fracPart}`.replace(/\.?0+$/, '')
}

function maskPubKey(key: string) {
    return `${key.slice(0, 7)}....${key.slice(-7)}`
}

function randomInRange(min: number, max: number): string {
    return (Math.random() * (max - min) + min).toFixed(2)
}

// A single /api/trade/bundle/sell call throws once packed wallets need more
// than 5 transactions (Jito's per-bundle cap) even after ALT compression —
// exactly what "Sell All" across many wallets used to hit. 5 wallets/chunk is
// the same conservative default the launch-builder Bundled Jito loop already
// uses for buys (safe even with zero ALT compression, since the legacy path
// caps at 4 wallets/tx and 5 chunks = 5 tx at worst). Sell isn't chunked
// there today — this wizard is where it gets fixed.
const BUNDLE_CHUNK_SIZE = 5
// Same anti-sniper reasoning as the buy loop: fire every chunk back-to-back
// with only a dispatch stagger, not a wait for each to land, so a large sell
// doesn't leave a multi-second window where part of it is already visible
// on-chain while the rest hasn't fired yet.
const FIRE_STAGGER_MS = 15

type ChunkStatus = 'pending' | 'running' | 'landed' | 'failed'

interface BundleChunkRow {
    walletIds: string[]
    status:    ChunkStatus
    bundleId?: string
    error?:    string
}

export default function BundleTradesWizard() {
    const [step, setStep]                       = useState(0)
    const [tradeType, setTradeType]             = useState<TradeType>('buy')
    const [tipMode, setTipMode]                 = useState<TipMode>('fixed')
    const [jitoTipSol, setJitoTipSol]           = useState('')
    const [floorPercentile, setFloorPercentile] = useState<FloorKey>('p50')
    const [tipFloorData, setTipFloorData]       = useState<TipFloorData | null>(null)
    const [tipFloorLoading, setTipFloorLoading] = useState(false)
    const [tipFloorError, setTipFloorError]     = useState(false)
    const [selectedWallets, setSelectedWallets] = useState<Set<string>>(new Set())
    const [tradeAmounts, setTradeAmounts]       = useState<Record<string, string>>({})
    const [randomRange, setRandomRange]         = useState(false)
    const [rangeMin, setRangeMin]               = useState('')
    const [rangeMax, setRangeMax]               = useState('')
    const [maxSolEnabled, setMaxSolEnabled]     = useState(false)
    const [maxSolTotal, setMaxSolTotal]         = useState('')
    const [wallets, setWallets]   = useState<WalletRecord[]>([])
    const [slippage, setSlippage] = useState(0.01)
    const [sellPct, setSellPct]                   = useState('')
    const [sellAllEnabled, setSellAllEnabled]     = useState(false)
    const [bundleLoopRows, setBundleLoopRows]     = useState<BundleChunkRow[]>([])
    const [tokenMint, setTokenMint]               = useState('')
    const [tokenResolved, setTokenResolved]       = useState(false)
    const [tokenName, setTokenName]               = useState('')
    const [tokenSymbol, setTokenSymbol]           = useState('')
    const [tokenBalances, setTokenBalances]       = useState<Record<string, string>>({})
    const [tokenDecimals, setTokenDecimals]       = useState(6)
    const [nextError, setNextError]               = useState<{ id: string; label: string }[]>([])
    const [errorWalletIds, setErrorWalletIds]     = useState<Set<string>>(new Set())
    const [executing, setExecuting]               = useState(false)
    const [bundleResult, setBundleResult]         = useState<{ bundleId: string; status: string } | null>(null)
    const [executeError, setExecuteError]         = useState<string | null>(null)

    const [autoCommentEnabled, setAutoCommentEnabled]           = useState(false)
    const [autoCommentDelayMinSec, setAutoCommentDelayMinSec]   = useState('180')
    const [autoCommentDelayMaxSec, setAutoCommentDelayMaxSec]   = useState('1800')
    const [autoCommentProbabilityPct, setAutoCommentProbabilityPct] = useState('100')
    const [autoCommentBankIds, setAutoCommentBankIds]           = useState<Set<string>>(new Set())

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

    const jitoTipLamports = useMemo((): BN | null => {
        if (tipMode === 'fixed') {
            const v = jitoTipSol.trim()
            if (!v || v === '.') return null
            try { return solStringToLamports(v) } catch { return null }
        }
        if (!tipFloorData) return null
        return new BN(Math.round(tipFloorData[floorPercentile]))
    }, [tipMode, jitoTipSol, tipFloorData, floorPercentile])

    const canProceed = useMemo(() => {
        if (step !== 0) return true
        if (!tokenResolved) return false
        if (slippage <= 0) return false
        const tipOk = tipMode === 'fixed'
            ? jitoTipLamports !== null && jitoTipLamports.gtn(0)
            : tipFloorData !== null
        if (!tipOk) return false
        if (selectedWallets.size === 0) return false
        if (tradeType === 'buy') {
            if (randomRange) {
                const min = parseFloat(rangeMin), max = parseFloat(rangeMax)
                if (isNaN(min) || isNaN(max) || max < min || min < 0) return false
            }
            if (maxSolEnabled) {
                const total = parseFloat(maxSolTotal)
                if (isNaN(total) || total <= 0) return false
            }
            if (autoCommentEnabled) {
                const dMin = parseFloat(autoCommentDelayMinSec), dMax = parseFloat(autoCommentDelayMaxSec)
                const prob = parseFloat(autoCommentProbabilityPct)
                if (isNaN(dMin) || isNaN(dMax) || dMax < dMin || dMin < 0) return false
                if (isNaN(prob) || prob < 0 || prob > 100) return false
                if (autoCommentBankIds.size === 0) return false
            }
        }
        return true
    }, [step, tradeType, tokenResolved, randomRange, rangeMin, rangeMax, maxSolEnabled, maxSolTotal, slippage, tipMode, jitoTipLamports, tipFloorData, selectedWallets, autoCommentEnabled, autoCommentDelayMinSec, autoCommentDelayMaxSec, autoCommentProbabilityPct, autoCommentBankIds])

    async function fetchTipFloor() {
        setTipFloorLoading(true)
        setTipFloorError(false)
        try {
            const res = await fetch('/api/trade/bundle/jito-tip-floor')
            if (!res.ok) throw new Error()
            setTipFloorData(await res.json())
        } catch {
            setTipFloorError(true)
        } finally {
            setTipFloorLoading(false)
        }
    }

    useEffect(() => {
        if (tipMode === 'floor') fetchTipFloor()
    }, [tipMode])

    // Clear trade amounts when trade type switches (SOL amounts ≠ token amounts)
    useEffect(() => {
        setTradeAmounts({})
        setSellPct('')
        setSellAllEnabled(false)
    }, [tradeType])

    // Sell All: select every wallet currently holding this token and set each
    // one's sell amount to its full live balance — re-runs whenever balances
    // (re)load so toggling it on before the token/balances have finished
    // fetching still resolves correctly once they arrive.
    useEffect(() => {
        if (!sellAllEnabled || tradeType !== 'sell') return
        const holderIds = wallets
            .map((w) => w.id)
            .filter((id) => {
                const raw = tokenBalances[id]
                return raw && raw !== '0'
            })
        if (holderIds.length === 0) return
        setSelectedWallets(new Set(holderIds))
        setSellPct('100')
        const newAmounts: Record<string, string> = {}
        holderIds.forEach((id) => { newAmounts[id] = tokenBalances[id] })
        setTradeAmounts(newAmounts)
    }, [sellAllEnabled, tradeType, tokenBalances, wallets])

    function rawPctAmount(rawBalance: string, pct: number): string {
        if (!rawBalance || rawBalance === '0' || pct <= 0) return '0'
        // Scale pct × 1000 to handle up to 1 decimal place (e.g. 33.5%)
        const pctScaled = BigInt(Math.round(pct * 1000))
        return (BigInt(rawBalance) * pctScaled / BigInt(100000)).toString()
    }

    function applyPctToWallets(pct: number, ids: Set<string>) {
        if (ids.size === 0 || pct <= 0) return
        const newAmounts = { ...tradeAmounts }
        ids.forEach((id) => {
            const raw = tokenBalances[id]
            if (raw && raw !== '0') newAmounts[id] = rawPctAmount(raw, pct)
        })
        setTradeAmounts(newAmounts)
    }

    function handleSellAllToggle(enabled: boolean) {
        setSellAllEnabled(enabled)
        // Population is handled by the effect above (keyed on tokenBalances/
        // wallets) — it fires immediately off this state change too.
    }

    function handleSellPctChange(value: string) {
        if (sellAllEnabled) return
        setSellPct(value)
        const pct = parseFloat(value)
        if (!isNaN(pct) && pct > 0 && selectedWallets.size > 0) {
            applyPctToWallets(pct, selectedWallets)
        }
    }

    function validRange(): { min: number; max: number } | null {
        const min = parseFloat(rangeMin)
        const max = parseFloat(rangeMax)
        if (!isNaN(min) && !isNaN(max) && max >= min && min >= 0) return { min, max }
        return null
    }

    function applyMaxSolSplit(total: number, walletIds: Set<string>, base: Record<string, string> = tradeAmounts) {
        if (walletIds.size === 0) return
        const perWallet = (total / walletIds.size).toFixed(4)
        const newAmounts = { ...base }
        walletIds.forEach((id) => { newAmounts[id] = perWallet })
        setTradeAmounts(newAmounts)
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

    function handleSelectionChange(newIds: Set<string>) {
        const newAmounts = { ...tradeAmounts }

        // Clear amounts for deselected wallets
        selectedWallets.forEach((id) => {
            if (!newIds.has(id)) delete newAmounts[id]
        })

        if (maxSolEnabled) {
            // Recalculate even split across all wallets with new set size
            const total = parseFloat(maxSolTotal)
            if (!isNaN(total) && total > 0 && newIds.size > 0) {
                const perWallet = (total / newIds.size).toFixed(4)
                newIds.forEach((id) => { newAmounts[id] = perWallet })
            }
        } else if (randomRange) {
            const range = validRange()
            if (range) {
                newIds.forEach((id) => {
                    if (!selectedWallets.has(id)) newAmounts[id] = randomInRange(range.min, range.max)
                })
            }
        } else if (tradeType === 'sell' && sellPct) {
            const pct = parseFloat(sellPct)
            if (!isNaN(pct) && pct > 0) {
                newIds.forEach((id) => {
                    if (!selectedWallets.has(id)) {
                        const raw = tokenBalances[id]
                        if (raw && raw !== '0') newAmounts[id] = rawPctAmount(raw, pct)
                    }
                })
            }
        }

        setTradeAmounts(newAmounts)
        setSelectedWallets(newIds)
    }

    function applyRangeToSelected(min: number, max: number) {
        if (selectedWallets.size === 0) return
        const newAmounts = { ...tradeAmounts }
        selectedWallets.forEach((id) => { newAmounts[id] = randomInRange(min, max) })
        setTradeAmounts(newAmounts)
    }

    function handleRandomRangeToggle(enabled: boolean) {
        setRandomRange(enabled)
        if (enabled && selectedWallets.size > 0) {
            const range = validRange()
            if (range) applyRangeToSelected(range.min, range.max)
        }
    }

    function handleRangeMinChange(value: string) {
        setRangeMin(value)
        if (!randomRange) return
        const min = parseFloat(value)
        const max = parseFloat(rangeMax)
        if (!isNaN(min) && !isNaN(max) && max >= min && min >= 0) applyRangeToSelected(min, max)
    }

    function handleRangeMaxChange(value: string) {
        setRangeMax(value)
        if (!randomRange) return
        const min = parseFloat(rangeMin)
        const max = parseFloat(value)
        if (!isNaN(min) && !isNaN(max) && max >= min && min >= 0) applyRangeToSelected(min, max)
    }

    useEffect(() => {
        setNextError([])
        setErrorWalletIds(new Set())
    }, [tradeAmounts, selectedWallets, slippage, tradeType])

    function handleNext() {
        setNextError([])
        setErrorWalletIds(new Set())
        if (step === 0 && tradeType === 'buy') {
            const TX_FEE_BUFFER = 10_000
            const failureLabels: { id: string; label: string }[] = []
            const failureIds = new Set<string>()
            for (const id of selectedWallets) {
                const wallet = wallets.find((w) => w.id === id)
                const amountStr = tradeAmounts[id]
                if (!wallet) continue
                const balance = wallet.solana_balance_in_lamports
                if (!balance || balance.isZero()) {
                    failureLabels.push({ id, label: wallet.label ?? maskPubKey(wallet.public_key) })
                    failureIds.add(id)
                    continue
                }
                if (!amountStr) continue
                let buyLamports: BN
                try { buyLamports = solStringToLamports(amountStr) } catch { continue }
                const required = new BN(Math.ceil(buyLamports.toNumber() * (1 + slippage)) + TX_FEE_BUFFER)
                if (balance.lt(required)) {
                    failureLabels.push({ id, label: wallet.label ?? maskPubKey(wallet.public_key) })
                    failureIds.add(id)
                }
            }
            if (failureLabels.length > 0) {
                setNextError(failureLabels)
                setErrorWalletIds(failureIds)
                return
            }
        }
        setStep((s) => s + 1)
    }

    // Fires one chunk's sell bundle and writes its result back into `rows` in
    // place — `rows` is a shared local array across a whole loop run (see
    // executeSellChunks/retryFailedChunks below), matching the exact pattern
    // launch-builder's Bundled Jito loop already uses: safe because each
    // call only ever touches its own index, so concurrent in-flight chunks
    // (fired with just a dispatch stagger, not awaited) never collide.
    async function fireSellChunk(rows: BundleChunkRow[], i: number) {
        const chunkIds = rows[i].walletIds
        rows[i] = { ...rows[i], status: 'running', error: undefined }
        setBundleLoopRows([...rows])

        const tradesList = chunkIds.map((id) => ({
            walletId:    id,
            mintAddress: tokenMint,
            tokenAmount: tradeAmounts[id] ?? '0',
            slippage,
        }))

        try {
            const res = await fetch('/api/trade/bundle/sell', {
                method:  'POST',
                headers: { 'Content-Type': 'application/json' },
                body:    JSON.stringify({
                    jitoTipInLamports: jitoTipLamports!.toString(),
                    tradesList,
                    useQuicknodeJito: true,
                }),
            })
            const data = await res.json()
            if (res.ok && data.success) {
                rows[i] = { ...rows[i], status: 'landed', bundleId: data.bundleId }
            } else {
                rows[i] = { ...rows[i], status: 'failed', error: data.error ?? 'Bundle submission failed' }
            }
        } catch (err) {
            rows[i] = { ...rows[i], status: 'failed', error: err instanceof Error ? err.message : 'Network error' }
        }
        setBundleLoopRows([...rows])
    }

    // Splits however many wallets are selling into BUNDLE_CHUNK_SIZE-wallet
    // bundles and fires them all — this is the actual fix for "sell all
    // fails past the Jito limit": no single /api/trade/bundle/sell call ever
    // carries more wallets than reliably fits in one bundle, regardless of
    // how many wallets are selected.
    async function executeSellChunks(walletIds: string[]) {
        const chunks: string[][] = []
        for (let i = 0; i < walletIds.length; i += BUNDLE_CHUNK_SIZE) {
            chunks.push(walletIds.slice(i, i + BUNDLE_CHUNK_SIZE))
        }

        const rows: BundleChunkRow[] = chunks.map((c) => ({ walletIds: c, status: 'pending' }))
        setBundleLoopRows([...rows])

        const firing: Promise<void>[] = []
        for (let i = 0; i < chunks.length; i++) {
            firing.push(fireSellChunk(rows, i))
            if (i < chunks.length - 1) await new Promise((r) => setTimeout(r, FIRE_STAGGER_MS))
        }
        await Promise.allSettled(firing)

        const failCount = rows.filter((r) => r.status === 'failed').length
        if (failCount > 0) {
            setExecuteError(`${chunks.length - failCount}/${chunks.length} bundle${chunks.length !== 1 ? 's' : ''} landed, ${failCount} failed — see below, or Retry Failed`)
        } else {
            setBundleResult({ bundleId: rows[rows.length - 1]?.bundleId ?? '', status: 'landed' })
        }
    }

    async function retryFailedChunks() {
        if (executing) return
        const rows = [...bundleLoopRows]
        const failedIndexes = rows.map((r, i) => (r.status === 'failed' ? i : -1)).filter((i) => i !== -1)
        if (failedIndexes.length === 0) return

        setExecuting(true)
        setExecuteError(null)
        try {
            const firing: Promise<void>[] = []
            for (const i of failedIndexes) {
                firing.push(fireSellChunk(rows, i))
                await new Promise((r) => setTimeout(r, FIRE_STAGGER_MS))
            }
            await Promise.allSettled(firing)

            const failCount = rows.filter((r) => r.status === 'failed').length
            if (failCount > 0) {
                setExecuteError(`${rows.length - failCount}/${rows.length} bundle${rows.length !== 1 ? 's' : ''} landed, ${failCount} failed — see below, or Retry Failed`)
            } else {
                setBundleResult({ bundleId: rows[rows.length - 1]?.bundleId ?? '', status: 'landed' })
            }
        } finally {
            setExecuting(false)
        }
    }

    async function handleExecute() {
        if (!jitoTipLamports || executing) return
        setExecuting(true)
        setExecuteError(null)
        setBundleResult(null)
        setBundleLoopRows([])

        try {
            if (tradeType === 'sell') {
                await executeSellChunks([...selectedWallets])
                return
            }

            const tradesList = [...selectedWallets].map((id) => ({
                walletId:    id,
                mintAddress: tokenMint,
                amountInSol: solStringToLamports(tradeAmounts[id] ?? '0').toString(),
                slippage,
            }))

            const res  = await fetch('/api/trade/bundle/buy', {
                method:  'POST',
                headers: { 'Content-Type': 'application/json' },
                body:    JSON.stringify({
                    jitoTipInLamports: jitoTipLamports.toString(),
                    tradesList: tradesList,
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

            const data = await res.json()

            if (!res.ok || !data.success) {
                setExecuteError(data.error ?? 'Bundle submission failed')
                return
            }

            setBundleResult({ bundleId: data.bundleId, status: data.status })
        } catch (err) {
            setExecuteError(err instanceof Error ? err.message : 'Network error')
        } finally {
            setExecuting(false)
        }
    }

    return (
        <div className="flex flex-col gap-4">
            <p className="text-xs text-muted-foreground">
                Bundle multiple {tradeType} orders into a single atomic transaction. All selected wallets execute simultaneously in one block via Jito.
            </p>
            <WizardShell
                steps={steps}
                current={step}
                onGoTo={setStep}
                onBack={() => setStep((s) => s - 1)}
                onNext={handleNext}
                nextDisabled={!canProceed}
            >
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

                        {/* Row 1: Trade Type */}
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
                                                ? t === 'buy'
                                                    ? 'bg-green-500 text-white shadow-sm'
                                                    : 'bg-red-500 text-white shadow-sm'
                                                : 'text-muted-foreground hover:text-foreground',
                                        ].join(' ')}
                                    >
                                        {t}
                                    </button>
                                ))}
                            </div>
                        </div>

                        {/* Row 2: trade-type-specific controls + Slippage */}
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
                                                        type="number"
                                                        min={0}
                                                        step={0.0001}
                                                        placeholder="0.00"
                                                        value={rangeMin}
                                                        onChange={(e) => handleRangeMinChange(e.target.value)}
                                                        className="w-20 rounded border border-input bg-transparent px-2 py-1 text-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                                                    />
                                                </div>
                                                <span className="text-muted-foreground text-sm mt-3">–</span>
                                                <div className="flex flex-col gap-1">
                                                    <span className="text-[10px] text-muted-foreground">Max SOL</span>
                                                    <input
                                                        type="number"
                                                        min={0}
                                                        step={0.0001}
                                                        placeholder="0.00"
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
                                                        type="number"
                                                        min={0}
                                                        step={0.0001}
                                                        placeholder="0.00"
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
                                                            type="number"
                                                            min={0}
                                                            value={autoCommentDelayMinSec}
                                                            onChange={(e) => setAutoCommentDelayMinSec(e.target.value)}
                                                            className="w-20 rounded border border-input bg-transparent px-2 py-1 text-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                                                        />
                                                    </div>
                                                    <span className="text-muted-foreground text-sm mt-3">–</span>
                                                    <div className="flex flex-col gap-1">
                                                        <span className="text-[10px] text-muted-foreground">Delay max (sec)</span>
                                                        <input
                                                            type="number"
                                                            min={0}
                                                            value={autoCommentDelayMaxSec}
                                                            onChange={(e) => setAutoCommentDelayMaxSec(e.target.value)}
                                                            className="w-20 rounded border border-input bg-transparent px-2 py-1 text-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                                                        />
                                                    </div>
                                                </div>
                                                <div className="flex flex-col gap-1">
                                                    <span className="text-[10px] text-muted-foreground">Chance to comment (%)</span>
                                                    <input
                                                        type="number"
                                                        min={0}
                                                        max={100}
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
                                <>
                                    {/* Amount to Sell */}
                                    <div className="flex flex-col gap-1.5">
                                        <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Amount to Sell</span>
                                        {sellAllEnabled ? (
                                            <p className="text-xs text-muted-foreground max-w-56 h-9 flex items-center">
                                                Locked at 100% while Sell All is enabled.
                                            </p>
                                        ) : (
                                            <>
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
                                                        type="number"
                                                        min={0}
                                                        max={100}
                                                        step={1}
                                                        placeholder="0"
                                                        value={sellPct}
                                                        onChange={(e) => handleSellPctChange(e.target.value)}
                                                        className="w-16 bg-transparent text-xs outline-none placeholder:text-muted-foreground [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                                                    />
                                                    <span className="text-xs text-muted-foreground shrink-0">%</span>
                                                </div>
                                            </>
                                        )}
                                    </div>

                                    {/* Sell All */}
                                    <div className="flex flex-col gap-1.5">
                                        <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Sell All</span>
                                        <label className="flex items-center gap-2 cursor-pointer select-none h-9">
                                            <input
                                                type="checkbox"
                                                checked={sellAllEnabled}
                                                onChange={(e) => handleSellAllToggle(e.target.checked)}
                                                className="size-4 rounded border border-input accent-red-500"
                                            />
                                            <span className="text-xs font-medium text-muted-foreground">Enable</span>
                                        </label>
                                        {sellAllEnabled && (
                                            <p className="text-[10px] text-muted-foreground max-w-52">
                                                {Object.keys(tokenBalances).length === 0
                                                    ? 'Checking wallet balances…'
                                                    : selectedWallets.size === 0
                                                        ? 'No wallets currently hold this token.'
                                                        : `Selling 100% from all ${selectedWallets.size} holding wallet${selectedWallets.size !== 1 ? 's' : ''}. Submitted as ${Math.ceil(selectedWallets.size / BUNDLE_CHUNK_SIZE)} bundle${Math.ceil(selectedWallets.size / BUNDLE_CHUNK_SIZE) !== 1 ? 's' : ''} of up to ${BUNDLE_CHUNK_SIZE} wallets each.`}
                                            </p>
                                        )}
                                    </div>
                                </>
                            )}

                            {/* Slippage */}
                            <div className="flex flex-col gap-1.5 min-w-48">
                                <SlippageControl value={slippage} onChange={setSlippage} />
                            </div>

                        </div>

                        {/* Row 3: Jito Tip */}
                        <div className="flex flex-wrap items-start gap-8">

                            {/* Jito Tip */}
                            <div className="flex flex-col gap-1.5">
                                <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Jito Tip</span>
                                <div className="flex gap-1 rounded-lg border border-input p-0.5 bg-muted/40">
                                    {(['fixed', 'floor'] as TipMode[]).map((m) => (
                                        <button
                                            key={m}
                                            type="button"
                                            onClick={() => setTipMode(m)}
                                            className={[
                                                'flex-1 px-3 py-1.5 rounded-md text-xs font-medium transition-colors whitespace-nowrap',
                                                tipMode === m
                                                    ? 'bg-background text-foreground shadow-sm'
                                                    : 'text-muted-foreground hover:text-foreground',
                                            ].join(' ')}
                                        >
                                            {m === 'fixed' ? 'Set Amount' : 'Beat Tip Floor %'}
                                        </button>
                                    ))}
                                </div>
                                {tipMode === 'fixed' ? (
                                    <div className="flex items-center gap-2 rounded-lg border border-input bg-transparent px-3 h-9 focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50 dark:bg-input/30">
                                        <input
                                            type="number"
                                            min={0}
                                            step={0.000000001}
                                            placeholder="0.00"
                                            value={jitoTipSol}
                                            onChange={(e) => setJitoTipSol(e.target.value)}
                                            className="w-24 bg-transparent text-xs outline-none placeholder:text-muted-foreground"
                                        />
                                        <span className="text-xs text-muted-foreground shrink-0">SOL</span>
                                    </div>
                                ) : (
                                    <div className="flex flex-col gap-1.5">
                                        <div className="flex flex-wrap gap-1">
                                            {FLOOR_OPTIONS.map(({ key, label }) => (
                                                <button
                                                    key={key}
                                                    type="button"
                                                    onClick={() => setFloorPercentile(key)}
                                                    className={[
                                                        'px-2.5 py-1.5 rounded-md text-xs font-medium border transition-colors',
                                                        floorPercentile === key
                                                            ? 'bg-blue-500 border-blue-500 text-white'
                                                            : 'border-border text-muted-foreground hover:border-blue-400 hover:text-foreground',
                                                    ].join(' ')}
                                                >
                                                    {label}
                                                </button>
                                            ))}
                                            <button
                                                type="button"
                                                onClick={fetchTipFloor}
                                                disabled={tipFloorLoading}
                                                title="Refresh"
                                                className="px-2 py-1.5 rounded-md text-xs border border-border text-muted-foreground hover:text-foreground transition-colors disabled:opacity-40"
                                            >
                                                ↻
                                            </button>
                                        </div>
                                        {tipFloorLoading && <span className="text-[10px] text-muted-foreground">Fetching…</span>}
                                        {tipFloorError  && <span className="text-[10px] text-destructive">Failed to fetch</span>}
                                    </div>
                                )}
                                {jitoTipLamports !== null && (
                                    <span className="text-[10px] text-muted-foreground tabular-nums">
                                        {jitoTipLamports.toString()} lamports ({lamportsBNToSolDisplay(jitoTipLamports)} SOL)
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
                                        The following wallets don't have enough SOL to cover the buy amount, slippage, and fees:
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
                {step === 1 && (() => {
                    const selectedArr = [...selectedWallets]
                    const totalBuySol = selectedArr.reduce((s, id) => s + (parseFloat(tradeAmounts[id] ?? '0') || 0), 0)
                    const floorLabel = FLOOR_OPTIONS.find((f) => f.key === floorPercentile)?.label
                    const totalSellRaw = selectedArr.reduce((s, id) => {
                        const raw = tradeAmounts[id]
                        return raw && raw !== '0' ? s + Number(raw) : s
                    }, 0)

                    return (
                        <div className="flex flex-col gap-5">
                            {/* Parameters summary */}
                            <div className="rounded-lg border border-border overflow-hidden divide-y divide-border text-xs">
                                <div className="flex items-center gap-3 px-4 py-2.5 bg-muted/20">
                                    <span className="w-28 shrink-0 font-medium text-muted-foreground">Token</span>
                                    <span className="flex items-center gap-1.5 text-foreground">
                                        {tokenName && <span className="font-medium">{tokenName}</span>}
                                        {tokenSymbol && <span className="text-muted-foreground">({tokenSymbol})</span>}
                                        <span className="font-mono text-[11px] text-muted-foreground">{maskPubKey(tokenMint)}</span>
                                    </span>
                                </div>
                                <div className="flex items-center gap-3 px-4 py-2.5">
                                    <span className="w-28 shrink-0 font-medium text-muted-foreground">Trade Type</span>
                                    <span className={tradeType === 'buy' ? 'font-medium text-green-500 capitalize' : 'font-medium text-red-500 capitalize'}>
                                        {tradeType}
                                    </span>
                                </div>
                                {tradeType === 'sell' && (
                                    <div className="flex items-center gap-3 px-4 py-2.5 bg-muted/20">
                                        <span className="w-28 shrink-0 font-medium text-muted-foreground">Sell Amount</span>
                                        <span className="tabular-nums text-foreground">
                                            {sellPct}%{sellAllEnabled ? ' (Sell All)' : ''}
                                        </span>
                                    </div>
                                )}
                                {tradeType === 'sell' && selectedWallets.size > BUNDLE_CHUNK_SIZE && (
                                    <div className="flex items-center gap-3 px-4 py-2.5">
                                        <span className="w-28 shrink-0 font-medium text-muted-foreground">Bundles</span>
                                        <span className="tabular-nums text-foreground">
                                            {Math.ceil(selectedWallets.size / BUNDLE_CHUNK_SIZE)} sequential bundles of up to {BUNDLE_CHUNK_SIZE} wallets
                                        </span>
                                    </div>
                                )}
                                {tradeType === 'buy' && randomRange && (
                                    <div className="flex items-center gap-3 px-4 py-2.5 bg-muted/20">
                                        <span className="w-28 shrink-0 font-medium text-muted-foreground">Trade Range</span>
                                        <span className="tabular-nums text-foreground">{rangeMin} – {rangeMax} SOL</span>
                                    </div>
                                )}
                                {tradeType === 'buy' && maxSolEnabled && maxSolTotal && (
                                    <div className="flex items-center gap-3 px-4 py-2.5 bg-muted/20">
                                        <span className="w-28 shrink-0 font-medium text-muted-foreground">Max SOL Split</span>
                                        <span className="tabular-nums text-foreground">
                                            {maxSolTotal} SOL ÷ {selectedWallets.size} wallets = {(parseFloat(maxSolTotal) / selectedWallets.size).toFixed(4)} SOL each
                                        </span>
                                    </div>
                                )}
                                {tradeType === 'buy' && autoCommentEnabled && (
                                    <div className="flex items-center gap-3 px-4 py-2.5 bg-muted/20">
                                        <span className="w-28 shrink-0 font-medium text-muted-foreground">Auto-Comment</span>
                                        <span className="tabular-nums text-foreground">
                                            {autoCommentDelayMinSec}–{autoCommentDelayMaxSec}s delay, {autoCommentProbabilityPct}% of wallets, {autoCommentBankIds.size} bank{autoCommentBankIds.size !== 1 ? 's' : ''}
                                        </span>
                                    </div>
                                )}
                                <div className="flex items-center gap-3 px-4 py-2.5">
                                    <span className="w-28 shrink-0 font-medium text-muted-foreground">Slippage</span>
                                    <span className="tabular-nums text-foreground">{(slippage * 100).toFixed(1)}%</span>
                                </div>
                                <div className="flex items-center gap-3 px-4 py-2.5 bg-muted/20">
                                    <span className="w-28 shrink-0 font-medium text-muted-foreground">Jito Tip</span>
                                    <span className="text-foreground">
                                        {tipMode === 'fixed'
                                            ? <span className="tabular-nums">{jitoTipSol} SOL</span>
                                            : <span>{floorLabel} percentile</span>
                                        }
                                        {jitoTipLamports !== null && tipMode === 'floor' && (
                                            <span className="ml-1 tabular-nums text-muted-foreground">
                                                ({lamportsBNToSolDisplay(jitoTipLamports)} SOL)
                                            </span>
                                        )}
                                    </span>
                                </div>
                            </div>

                            {/* Wallet table */}
                            <div className="flex flex-col gap-2">
                                <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                                    Wallets ({selectedWallets.size})
                                </span>
                                <div className="rounded-lg border border-border overflow-hidden">
                                    <table className="w-full text-xs">
                                        <thead>
                                            <tr className="bg-muted/30 border-b border-border">
                                                <th className="px-3 py-2 text-left font-medium text-muted-foreground">Wallet</th>
                                                <th className="px-3 py-2 text-right font-medium text-muted-foreground">SOL Balance</th>
                                                <th className="px-3 py-2 text-right font-medium text-muted-foreground">
                                                    {tradeType === 'buy' ? 'Buy Amount' : 'Sell Amount'}
                                                </th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-border">
                                            {selectedArr.map((id) => {
                                                const w = wallets.find((wl) => wl.id === id)
                                                if (!w) return null
                                                return (
                                                    <tr key={id}>
                                                        <td className="px-3 py-2 font-mono text-[11px]">
                                                            {w.label && <span className="font-sans text-xs text-foreground">{w.label} · </span>}
                                                            {maskPubKey(w.public_key)}
                                                        </td>
                                                        <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">
                                                            {w.solana_balance_in_lamports
                                                                ? `${lamportsBNToSolDisplay(w.solana_balance_in_lamports)} SOL`
                                                                : '—'}
                                                        </td>
                                                        {tradeType === 'buy' ? (
                                                            <td className="px-3 py-2 text-right tabular-nums font-medium text-green-500">
                                                                {tradeAmounts[id] ? `${tradeAmounts[id]} SOL` : '—'}
                                                            </td>
                                                        ) : (
                                                            <td className="px-3 py-2 text-right tabular-nums font-medium text-red-500">
                                                                {tradeAmounts[id]
                                                                    ? `${formatTokenAmount(tradeAmounts[id], tokenDecimals)} ${tokenSymbol || 'tokens'}`
                                                                    : '—'}
                                                            </td>
                                                        )}
                                                    </tr>
                                                )
                                            })}
                                        </tbody>
                                        {selectedWallets.size > 0 && (
                                            <tfoot>
                                                <tr className="border-t border-border bg-muted/20">
                                                    <td className="px-3 py-2 font-medium text-muted-foreground" colSpan={2}>Total</td>
                                                    {tradeType === 'buy' ? (
                                                        <td className="px-3 py-2 text-right tabular-nums font-semibold text-green-500">
                                                            {totalBuySol.toFixed(4)} SOL
                                                        </td>
                                                    ) : (
                                                        <td className="px-3 py-2 text-right tabular-nums font-semibold text-red-500">
                                                            {formatTokenAmount(String(Math.round(totalSellRaw)), tokenDecimals)} {tokenSymbol || 'tokens'}
                                                        </td>
                                                    )}
                                                </tr>
                                            </tfoot>
                                        )}
                                    </table>
                                </div>
                            </div>
                        </div>
                    )
                })()}
                {step === 2 && (() => {
                    const chunkCount = tradeType === 'sell' ? Math.ceil(selectedWallets.size / BUNDLE_CHUNK_SIZE) : 1
                    return (
                    <div className="flex flex-col gap-5">
                        {/* Ready state */}
                        {!executing && !bundleResult && !executeError && bundleLoopRows.length === 0 && (
                            <div className="flex flex-col gap-4">
                                <p className="text-xs text-muted-foreground">
                                    {chunkCount > 1
                                        ? `Ready to submit ${selectedWallets.size} sell transactions as ${chunkCount} sequential Jito bundles (up to ${BUNDLE_CHUNK_SIZE} wallets each — a single bundle can't fit more than a few wallets once Jito's transaction cap is hit).`
                                        : `Ready to submit ${selectedWallets.size} ${tradeType} transaction${selectedWallets.size !== 1 ? 's' : ''} as a Jito bundle. All trades execute atomically in a single block.`}
                                </p>
                                <button
                                    type="button"
                                    onClick={handleExecute}
                                    className={[
                                        'self-start px-6 py-2 rounded-lg text-sm font-semibold text-white transition-colors',
                                        tradeType === 'buy'
                                            ? 'bg-green-500 hover:bg-green-600'
                                            : 'bg-red-500 hover:bg-red-600',
                                    ].join(' ')}
                                >
                                    Execute Bundle{chunkCount > 1 ? `s (${chunkCount})` : ''}
                                </button>
                            </div>
                        )}

                        {/* Chunked sell progress — one row per bundle */}
                        {bundleLoopRows.length > 0 && (
                            <div className="flex flex-col gap-3">
                                <div className="flex flex-col divide-y divide-border rounded-lg border border-border overflow-hidden">
                                    {bundleLoopRows.map((row, i) => (
                                        <div key={i} className="flex items-center gap-3 px-4 py-2.5 text-xs">
                                            <div className="size-4 shrink-0 flex items-center justify-center">
                                                {row.status === 'pending' && <span className="size-2 rounded-full bg-muted-foreground/30" />}
                                                {row.status === 'running' && <span className="size-3.5 animate-spin rounded-full border-2 border-red-500 border-t-transparent" />}
                                                {row.status === 'landed' && (
                                                    <svg className="size-3.5 text-green-500" viewBox="0 0 20 20" fill="currentColor">
                                                        <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                                                    </svg>
                                                )}
                                                {row.status === 'failed' && (
                                                    <svg className="size-3.5 text-destructive" viewBox="0 0 20 20" fill="currentColor">
                                                        <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
                                                    </svg>
                                                )}
                                            </div>
                                            <span className="flex-1 text-muted-foreground">
                                                Bundle {i + 1} — {row.walletIds.length} wallet{row.walletIds.length !== 1 ? 's' : ''}
                                            </span>
                                            {row.status === 'landed' && row.bundleId && (
                                                <span className="font-mono text-[10px] text-muted-foreground truncate max-w-40">{row.bundleId}</span>
                                            )}
                                            {row.status === 'failed' && row.error && (
                                                <span className="text-[10px] text-destructive truncate max-w-40">{row.error}</span>
                                            )}
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}

                        {/* Loading — plain spinner for the single-bundle buy path, before any chunk rows exist */}
                        {executing && bundleLoopRows.length === 0 && (
                            <div className="flex items-center gap-3 text-xs text-muted-foreground">
                                <svg className="size-4 animate-spin shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                    <path d="M21 12a9 9 0 1 1-6.219-8.56" />
                                </svg>
                                Submitting bundle to Jito and waiting for confirmation…
                            </div>
                        )}

                        {/* Success */}
                        {bundleResult && (
                            <div className="flex flex-col gap-3">
                                <div className="flex items-center gap-2 text-green-500 text-sm font-semibold">
                                    <svg className="size-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                        <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" /><polyline points="22 4 12 14.01 9 11.01" />
                                    </svg>
                                    {bundleLoopRows.length > 1 ? `All ${bundleLoopRows.length} bundles landed` : `Bundle ${bundleResult.status}`}
                                </div>
                                {bundleLoopRows.length <= 1 && (
                                    <div className="rounded-lg border border-border bg-muted/20 px-4 py-3 text-xs">
                                        <span className="text-muted-foreground">Bundle ID </span>
                                        <span className="font-mono break-all text-foreground">{bundleResult.bundleId}</span>
                                    </div>
                                )}
                            </div>
                        )}

                        {/* Error */}
                        {executeError && (
                            <div className="flex flex-col gap-3">
                                <div role="alert" className="flex gap-3 rounded-lg border border-destructive/50 bg-destructive/10 px-4 py-3 text-destructive">
                                    <svg className="mt-0.5 size-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                        <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                                        <line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" />
                                    </svg>
                                    <span className="text-xs">{executeError}</span>
                                </div>
                                <button
                                    type="button"
                                    onClick={bundleLoopRows.length > 0 ? retryFailedChunks : handleExecute}
                                    disabled={executing}
                                    className="self-start px-4 py-1.5 rounded-md text-xs font-medium border border-border text-muted-foreground hover:text-foreground transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                                >
                                    {bundleLoopRows.length > 0 ? 'Retry Failed' : 'Retry'}
                                </button>
                            </div>
                        )}
                    </div>
                    )
                })()}
            </WizardShell>
        </div>
    )
}
