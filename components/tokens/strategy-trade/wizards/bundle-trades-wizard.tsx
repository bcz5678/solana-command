'use client'

import { useState, useMemo, useEffect } from 'react'
import BN from 'bn.js'
import WizardShell, { StepPlaceholder, WizardStep } from './wizard-shell'
import StrategyWalletSelector from '@/components/tokens/strategy-trade/strategy-wallet-selector'
import { solStringToLamports, lamportsBNToSolDisplay, lamportsStringToBN } from '@/lib/lamports'
import { WalletRecord } from '@/lib/types/wallet'
import {
    Select,
    SelectContent,
    SelectGroup,
    SelectItem,
    SelectLabel,
    SelectSeparator,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select'
import { SlippageControl } from '@/components/tokens/trade/SlippageControl'
import { TokenMintInput } from '@/components/tokens/strategy-trade/TokenMintInput'

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

function maskPubKey(key: string) {
    return `${key.slice(0, 7)}....${key.slice(-7)}`
}

function randomInRange(min: number, max: number): string {
    return (Math.random() * (max - min) + min).toFixed(2)
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
    const [wallets, setWallets]                 = useState<WalletRecord[]>([])
    const [tipPayerWalletId, setTipPayerWalletId] = useState('')
    const [slippage, setSlippage]                 = useState(0.01)
    const [sellPct, setSellPct]                   = useState('')
    const [tokenMint, setTokenMint]               = useState('')
    const [tokenResolved, setTokenResolved]       = useState(false)
    const [tokenName, setTokenName]               = useState('')
    const [tokenSymbol, setTokenSymbol]           = useState('')
    const [tokenBalances, setTokenBalances]       = useState<Record<string, string>>({})
    const [tokenDecimals, setTokenDecimals]       = useState(6)
    const [nextError, setNextError]               = useState<{ id: string; label: string }[]>([])
    const [errorWalletIds, setErrorWalletIds]     = useState<Set<string>>(new Set())

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

    const tipPayerGroups = useMemo<[string, WalletRecord[]][]>(() => {
        const withSol = wallets.filter(
            (w) => w.solana_balance_in_lamports != null && w.solana_balance_in_lamports.gtn(0),
        )
        const map: Record<string, WalletRecord[]> = {}
        for (const w of withSol) {
            const key = w.wallet_type ?? 'Other'
            ;(map[key] ??= []).push(w)
        }
        return Object.entries(map)
    }, [wallets])

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
        if (tradeType === 'buy') {
            if (!tokenResolved) return false
            if (randomRange) {
                const min = parseFloat(rangeMin), max = parseFloat(rangeMax)
                if (isNaN(min) || isNaN(max) || max < min || min < 0) return false
            }
            if (maxSolEnabled) {
                const total = parseFloat(maxSolTotal)
                if (isNaN(total) || total <= 0) return false
            }
            if (slippage <= 0) return false
            const tipOk = tipMode === 'fixed'
                ? jitoTipLamports !== null && jitoTipLamports.gtn(0)
                : tipFloorData !== null
            if (!tipOk) return false
            if (!tipPayerWalletId) return false
            if (selectedWallets.size === 0) return false
        }
        return true
    }, [step, tradeType, tokenResolved, randomRange, rangeMin, rangeMax, maxSolEnabled, maxSolTotal, slippage, tipMode, jitoTipLamports, tipFloorData, tipPayerWalletId, selectedWallets])

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
    }, [tradeType])

    function rawPctAmount(rawBalance: string, pct: number): string {
        if (!rawBalance || rawBalance === '0' || pct <= 0) return '0'
        // Scale pct × 1000 to handle up to 1 decimal place (e.g. 33.5%)
        const pctScaled = BigInt(Math.round(pct * 1000))
        return (BigInt(rawBalance) * pctScaled / 100_000n).toString()
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

    function handleSellPctChange(value: string) {
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

    return (
        <div className="flex flex-col gap-4">
            <p className="text-xs text-muted-foreground">
                Bundle multiple buy orders into a single atomic transaction. All selected wallets execute simultaneously in one block via Jito.
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
                                </>
                            ) : (
                                /* Amount to Sell */
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
                                </div>
                            )}

                            {/* Slippage */}
                            <div className="flex flex-col gap-1.5 min-w-48">
                                <SlippageControl value={slippage} onChange={setSlippage} />
                            </div>

                        </div>

                        {/* Row 3: Jito Tip + Tip Payer */}
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

                            {/* Tip Payer */}
                            <div className="flex flex-col gap-1.5">
                                <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Tip Payer</span>
                                <Select value={tipPayerWalletId} onValueChange={setTipPayerWalletId}>
                                    <SelectTrigger className="h-9 text-xs w-52">
                                        <SelectValue placeholder="Select wallet" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {tipPayerGroups.map(([typeName, group], i) => (
                                            <SelectGroup key={typeName}>
                                                {i > 0 && <SelectSeparator />}
                                                <SelectLabel>{typeName}</SelectLabel>
                                                {group.map((w) => (
                                                    <SelectItem key={w.id} value={w.id}>
                                                        {w.label ? `${w.label} · ` : ''}
                                                        {maskPubKey(w.public_key)}
                                                        {' · '}
                                                        {lamportsBNToSolDisplay(w.solana_balance_in_lamports!)} SOL
                                                    </SelectItem>
                                                ))}
                                            </SelectGroup>
                                        ))}
                                        {tipPayerGroups.length === 0 && (
                                            <div className="px-3 py-4 text-center text-xs text-muted-foreground">
                                                No wallets with SOL found
                                            </div>
                                        )}
                                    </SelectContent>
                                </Select>
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
                    const tipPayerWallet = wallets.find((w) => w.id === tipPayerWalletId)
                    const selectedArr = [...selectedWallets]
                    const totalBuySol = selectedArr.reduce((s, id) => s + (parseFloat(tradeAmounts[id] ?? '0') || 0), 0)
                    const floorLabel = FLOOR_OPTIONS.find((f) => f.key === floorPercentile)?.label

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
                                        <span className="tabular-nums text-foreground">{sellPct}%</span>
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
                                {tipPayerWallet && (
                                    <div className="flex items-center gap-3 px-4 py-2.5">
                                        <span className="w-28 shrink-0 font-medium text-muted-foreground">Tip Payer</span>
                                        <span className="font-mono text-foreground text-[11px]">
                                            {tipPayerWallet.label && (
                                                <span className="font-sans text-xs">{tipPayerWallet.label} · </span>
                                            )}
                                            {maskPubKey(tipPayerWallet.public_key)}
                                            {' · '}
                                            <span className="tabular-nums">{lamportsBNToSolDisplay(tipPayerWallet.solana_balance_in_lamports!)} SOL</span>
                                        </span>
                                    </div>
                                )}
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
                                                <th className="px-3 py-2 text-right font-medium text-muted-foreground">Balance</th>
                                                {tradeType === 'buy' && (
                                                    <th className="px-3 py-2 text-right font-medium text-muted-foreground">Buy Amount</th>
                                                )}
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
                                                        {tradeType === 'buy' && (
                                                            <td className="px-3 py-2 text-right tabular-nums font-medium text-green-500">
                                                                {tradeAmounts[id] ? `${tradeAmounts[id]} SOL` : '—'}
                                                            </td>
                                                        )}
                                                    </tr>
                                                )
                                            })}
                                        </tbody>
                                        {tradeType === 'buy' && selectedWallets.size > 0 && (
                                            <tfoot>
                                                <tr className="border-t border-border bg-muted/20">
                                                    <td className="px-3 py-2 font-medium text-muted-foreground" colSpan={2}>Total</td>
                                                    <td className="px-3 py-2 text-right tabular-nums font-semibold text-green-500">
                                                        {totalBuySol.toFixed(4)} SOL
                                                    </td>
                                                </tr>
                                            </tfoot>
                                        )}
                                    </table>
                                </div>
                            </div>
                        </div>
                    )
                })()}
                {step === 2 && (
                    <StepPlaceholder
                        title="Execute Bundle"
                        description="Submit bundle to Jito and monitor confirmation status in real time"
                    />
                )}
            </WizardShell>
        </div>
    )
}
