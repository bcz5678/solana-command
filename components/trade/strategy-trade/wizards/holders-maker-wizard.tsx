'use client'

import { useState } from 'react'
import WizardShell, { StepPlaceholder, WizardStep } from './wizard-shell'
import StrategyWalletSelector from '@/components/trade/strategy-trade/strategy-wallet-selector'

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
        label: 'Distribution',
        icon: (
            <svg className="size-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" />
                <path d="M23 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" />
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

export default function HoldersMakerWizard() {
    const [step, setStep]                       = useState(0)
    const [selectedWallets, setSelectedWallets] = useState<Set<string>>(new Set())
    const [tradeAmounts, setTradeAmounts]       = useState<Record<string, string>>({})

    return (
        <div className="flex flex-col gap-4">
            <p className="text-xs text-muted-foreground">
                Distribute tokens across selected wallets to create unique on-chain holders and improve holder count metrics.
            </p>
            <WizardShell
                steps={steps}
                current={step}
                onGoTo={setStep}
                onBack={() => setStep((s) => s - 1)}
                onNext={() => setStep((s) => s + 1)}
            >
                {step === 0 && (
                    <StrategyWalletSelector
                        selectedIds={selectedWallets}
                        onSelectionChange={setSelectedWallets}
                        onTradeAmountChange={(id, amt) => setTradeAmounts((p) => ({ ...p, [id]: amt }))}
                        onTradeAmountReset={() => setTradeAmounts({})}
                        defaultTypeName="Holder"
                    />
                )}
                {step === 1 && (
                    <StepPlaceholder
                        title="Distribution Preview"
                        description="Preview token allocation per wallet and verify each wallet will receive a unique non-dust amount"
                    />
                )}
                {step === 2 && (
                    <StepPlaceholder
                        title="Review Holder Plan"
                        description="Confirm total tokens to distribute, wallet count, estimated fees, and stagger timing"
                    />
                )}
                {step === 3 && (
                    <StepPlaceholder
                        title="Execute Distribution"
                        description="Send tokens to each holder wallet and monitor transfer confirmations"
                    />
                )}
            </WizardShell>
        </div>
    )
}
