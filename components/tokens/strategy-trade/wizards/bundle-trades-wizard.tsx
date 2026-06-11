'use client'

import { useState, useMemo } from 'react'
import WizardShell, { StepPlaceholder, WizardStep } from './wizard-shell'
import StrategyWalletSelector from '@/components/tokens/strategy-trade/strategy-wallet-selector'
import { solStringToLamports } from '@/lib/lamports'

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

export default function BundleTradesWizard() {
    const [step, setStep]                       = useState(0)
    const [tradeType, setTradeType]             = useState<TradeType>('buy')
    const [jitoTipSol, setJitoTipSol]           = useState('')
    const [selectedWallets, setSelectedWallets] = useState<Set<string>>(new Set())
    const [tradeAmounts, setTradeAmounts]       = useState<Record<string, string>>({})

    const jitoTipLamports = useMemo(() => {
        const v = jitoTipSol.trim()
        if (!v || v === '.') return null
        try { return solStringToLamports(v) } catch { return null }
    }, [jitoTipSol])

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
                onNext={() => setStep((s) => s + 1)}
            >
                {step === 0 && (
                    <div className="flex flex-col gap-6">

                        {/* Trade type + Jito tip */}
                        <div className="flex flex-wrap items-end gap-6">

                            {/* Buy / Sell radio */}
                            <div className="flex flex-col gap-1.5">
                                <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Trade Type</span>
                                <div className="flex gap-1 rounded-lg border border-input p-0.5 bg-muted/40">
                                    {(['buy', 'sell'] as TradeType[]).map((t) => (
                                        <button
                                            key={t}
                                            type="button"
                                            onClick={() => setTradeType(t)}
                                            className={[
                                                'flex-1 px-5 py-1.5 rounded-md text-sm font-medium transition-colors capitalize',
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

                            {/* Jito tip */}
                            <div className="flex flex-col gap-1.5">
                                <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Jito Tip</span>
                                <div className="flex items-center gap-2 rounded-lg border border-input bg-transparent px-3 h-9 focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50 dark:bg-input/30">
                                    <input
                                        type="number"
                                        min={0}
                                        step={0.000000001}
                                        placeholder="0.00"
                                        value={jitoTipSol}
                                        onChange={(e) => setJitoTipSol(e.target.value)}
                                        className="w-28 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
                                    />
                                    <span className="text-xs text-muted-foreground shrink-0">SOL</span>
                                </div>
                                {jitoTipLamports !== null && (
                                    <span className="text-[10px] text-muted-foreground tabular-nums">
                                        {jitoTipLamports.toString()} lamports
                                    </span>
                                )}
                            </div>

                        </div>

                        {/* Wallet selector */}
                        <StrategyWalletSelector
                            selectedIds={selectedWallets}
                            onSelectionChange={setSelectedWallets}
                            onTradeAmountChange={(id, amt) => setTradeAmounts((p) => ({ ...p, [id]: amt }))}
                            onTradeAmountReset={() => setTradeAmounts({})}
                            defaultTypeName="Trader"
                        />

                    </div>
                )}
                {step === 1 && (
                    <StepPlaceholder
                        title="Review Bundle"
                        description="Review all wallet trades, estimated costs, and bundle composition before submitting"
                    />
                )}
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
