'use client'

import { useState } from 'react'
import WizardShell, { StepPlaceholder, WizardStep } from './wizard-shell'
import StrategyWalletSelector from '@/components/trade/strategy-trade/strategy-wallet-selector'

const steps: WizardStep[] = [
    {
        label: 'Target',
        icon: (
            <svg className="size-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10" /><circle cx="12" cy="12" r="6" /><circle cx="12" cy="12" r="2" />
            </svg>
        ),
    },
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

export default function TrendingVolumeWizard() {
    const [step, setStep]                       = useState(0)
    const [selectedWallets, setSelectedWallets] = useState<Set<string>>(new Set())
    const [tradeAmounts, setTradeAmounts]       = useState<Record<string, string>>({})

    return (
        <div className="flex flex-col gap-4">
            <p className="text-xs text-muted-foreground">
                Generate volume engineered to meet the thresholds of DEX trending algorithms — DexScreener, Birdeye, and Pump.fun trending boards.
            </p>
            <WizardShell
                steps={steps}
                current={step}
                onGoTo={setStep}
                onBack={() => setStep((s) => s - 1)}
                onNext={() => setStep((s) => s + 1)}
            >
                {step === 0 && (
                    <StepPlaceholder
                        title="Trending Target"
                        description="Select the platform to target and the trending tier / threshold to hit"
                    />
                )}
                {step === 1 && (
                    <StrategyWalletSelector
                        selectedIds={selectedWallets}
                        onSelectionChange={setSelectedWallets}
                        onTradeAmountChange={(id, amt) => setTradeAmounts((p) => ({ ...p, [id]: amt }))}
                        onTradeAmountReset={() => setTradeAmounts({})}
                        defaultTypeName="Volume"
                    />
                )}
                {step === 2 && (
                    <StepPlaceholder
                        title="Review Trending Plan"
                        description="Confirm estimated cost, projected volume, target platform, and execution window"
                    />
                )}
                {step === 3 && (
                    <StepPlaceholder
                        title="Execute Trending Volume"
                        description="Run the strategy and monitor trending rank, volume output, and wallet health in real time"
                    />
                )}
            </WizardShell>
        </div>
    )
}
