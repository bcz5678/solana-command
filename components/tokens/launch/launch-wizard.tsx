'use client'

import { useState } from 'react'
import TokenSelect from '@/components/tokens/launch/token-select'
import LaunchTypeSelect from '@/components/tokens/launch/launch-type-select';
import LaunchCurrentConfiguration from '@/components/tokens/launch/launch-current-configuration'
import { LaunchType } from './types'
import { CreatedTokenDTO } from '@/app/db/models/token';
import LaunchBuyerConfig from './launch-buyer-config';
import { LaunchConfig } from './launch-config-class';

import BN from 'bn.js';
import { solStringToLamports } from '@/lib/lamports';
import LaunchToken from './launch-token';

const nextButtonLabels: Record<number, string> = {
    0: 'Select Launch Type',
    1: 'Configure Buyers',
    2: 'Review & Launch',
    3: 'Done',
}

const steps = [
    {
        label: 'Select Token',
        icon: (
            <svg className="size-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10" />
                <path d="M12 6v6l4 2" />
            </svg>
        ),
    },
    {
        label: 'Launch Type',
        icon: (
            <svg className="size-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09z" />
                <path d="m12 15-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2z" />
                <path d="M9 12H4s.55-3.03 2-4c1.62-1.08 5 0 5 0" />
                <path d="M12 15v5s3.03-.55 4-2c1.08-1.62 0-5 0-5" />
            </svg>
        ),
    },
    {
        label: 'Buyer Config',
        icon: (
            <svg className="size-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
                <circle cx="9" cy="7" r="4" />
                <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
                <path d="M16 3.13a4 4 0 0 1 0 7.75" />
            </svg>
        ),
    },
    {
        label: 'Launch Token',
        icon: (
            <svg className="size-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="22 7 13.5 15.5 8.5 10.5 2 17" />
                <polyline points="16 7 22 7 22 13" />
            </svg>
        ),
    },
]


export default function LaunchWizard() {
    const [currentStep, setCurrentStep] = useState(0)
    const [selectedTokenId, setSelectedTokenId] = useState<number | null>(null)
    const [launchConfig, setLaunchConfig] = useState<LaunchConfig>(
        new LaunchConfig(
            LaunchType.unselected,
            null,
            new BN(0),
            new BN(0),
            new BN(0),
            new BN(0),
            [],
        )
    );

    function onTokenSelect(token: CreatedTokenDTO) {
        setSelectedTokenId(token.id ?? null)
        setLaunchConfig((prev) => prev.copyWith({ token }))
    }

    function onLaunchTypeSelect(selectedLaunchType: LaunchType) {
        setLaunchConfig((prev) => prev.copyWith({ launchType: selectedLaunchType }))
    }

    function onBuyInputChange(walletId: number, newAmount: string) {
        const newAmountInLamports = solStringToLamports(newAmount);
        launchConfig.updateWalletList(walletId, newAmountInLamports, "buy")
        setLaunchConfig((prev) => prev.copyWith({
            walletTrades: launchConfig.walletTrades,
            totalSOLInLamports: launchConfig.totalSOLInLamports,
        }));
    }

    function onBuyInputReset() {
        launchConfig.clearWalletList();
        setLaunchConfig((prev) => prev.copyWith({
            totalSOLInLamports: launchConfig.totalSOLInLamports,
            tokensTotal: launchConfig.tokensTotal,
            percentOfSupply: launchConfig.percentOfSupply,
            marketCap: launchConfig.marketCap,
            walletTrades: launchConfig.walletTrades,
        }));
    }


    return (
        <div className="w-full flex flex-col gap-8">
            <div className="w-full flex flew-row gap-4">
                <div className="flex-1">
                </div>
                <div className="flex-3">
                    <LaunchCurrentConfiguration
                        launchConfig={launchConfig}
                    />
                </div>
            </div>

            {/* Progress bar */}
            <div className="w-full flex items-center">
                {steps.map((step, i) => {
                    const isDone = i < currentStep
                    const isActive = i === currentStep
                    const isUpcoming = i > currentStep

                    return (
                        <div key={i} className="flex-1 flex items-center">
                            {/* Step node */}
                            <div className="flex flex-col items-center gap-1.5 shrink-0">
                                <button
                                    onClick={() => isDone && setCurrentStep(i)}
                                    disabled={isUpcoming}
                                    className={[
                                        'flex items-center justify-center size-10 rounded-full border-2 transition-colors',
                                        isDone
                                            ? 'border-blue-500 bg-blue-500 text-white cursor-pointer hover:bg-blue-600'
                                            : isActive
                                            ? 'border-blue-500 bg-blue-500 text-white cursor-default'
                                            : 'border-muted-foreground/30 bg-muted text-muted-foreground/40 cursor-not-allowed',
                                    ].join(' ')}
                                >
                                    {isDone ? (
                                        <svg className="size-4" viewBox="0 0 20 20" fill="currentColor">
                                            <path fillRule="evenodd" d="M16.707 5.293a1 1 0 00-1.414 0L8 12.586 4.707 9.293a1 1 0 00-1.414 1.414l4 4a1 1 0 001.414 0l8-8a1 1 0 000-1.414z" clipRule="evenodd" />
                                        </svg>
                                    ) : (
                                        step.icon
                                    )}
                                </button>
                                <span className={[
                                    'text-xs font-medium whitespace-nowrap',
                                    isActive ? 'text-blue-500' : isDone ? 'text-blue-400' : 'text-muted-foreground/40',
                                ].join(' ')}>
                                    {step.label}
                                </span>
                            </div>

                            {/* Connector line — not after the last step */}
                            {i < steps.length - 1 && (
                                <div className={[
                                    'flex-1 h-0.5 mx-2 mb-6 transition-colors',
                                    i < currentStep ? 'bg-blue-500' : 'bg-muted-foreground/20',
                                ].join(' ')} />
                            )}
                        </div>
                    )
                })}
            </div>

            {/* Step content */}
            <div className="w-full">
                {currentStep === 0 && (
                    <TokenSelect selectedId={selectedTokenId} onSelect={onTokenSelect} />
                )}
                {currentStep === 1 && (
                    <LaunchTypeSelect selectedType={launchConfig.launchType} onSelect={onLaunchTypeSelect} />
                )}
                {currentStep === 2 && (
                    <LaunchBuyerConfig launchConfig={launchConfig} onBuyInputChange={onBuyInputChange} onBuyInputReset={onBuyInputReset} />
                )}
                {currentStep === 3 && (
                    <LaunchToken launchConfig={launchConfig} />
                )}
            </div>

            {/* Navigation */}
            <div className="flex gap-2">
                <button
                    onClick={() => setCurrentStep((s) => Math.max(0, s - 1))}
                    disabled={currentStep === 0}
                    className="px-3 py-1.5 text-sm rounded border border-border disabled:opacity-40"
                >
                    Back
                </button>
                <button
                    onClick={() => setCurrentStep((s) => Math.min(steps.length - 1, s + 1))}
                    disabled={
                        currentStep === steps.length - 1 ||
                        (currentStep === 0 && selectedTokenId === null) ||
                        (currentStep === 1 && launchConfig.launchType === LaunchType.unselected)
                    }
                    className="px-3 py-1.5 text-sm rounded border border-border disabled:opacity-40"
                >
                    {nextButtonLabels[currentStep] ?? 'Next'}
                </button>
            </div>
        </div>
    )
}
