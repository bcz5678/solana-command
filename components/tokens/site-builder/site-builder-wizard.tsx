'use client'

import { useState } from 'react'
import LaunchTokenSelect from '@/components/tokens/launch/launch-token-select'
import { TokenMint } from '@/lib/types/token-mint'
import SiteStart from './site-start'
import SiteExistingSelect, { MockExistingSite } from './site-existing-select'
import SiteTemplateSelect from './site-template-select'
import SiteDomainSetup from './site-domain-setup'
import SiteConfig from './site-config'
import SiteExecute from './site-execute'
import { defaultSiteBuilderConfig, SiteBuilderMode } from './types'

function nextButtonLabel(step: number, mode: SiteBuilderMode | null): string {
    const labels: Record<number, string> = {
        0: mode === 'edit' ? 'Select Existing Site' : 'Select Token',
        1: 'Choose Template',
        2: 'Set Up Domain',
        3: 'Configure Site',
        4: 'Review & Deploy',
        5: 'Done',
    }
    return labels[step] ?? 'Next'
}

const steps = [
    {
        label: 'Get Started',
        icon: (
            <svg className="size-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 3v18" />
                <path d="M3 12h18" />
            </svg>
        ),
    },
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
        label: 'Site Template',
        icon: (
            <svg className="size-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="3" width="18" height="18" rx="2" />
                <path d="M3 9h18" />
                <path d="M9 21V9" />
            </svg>
        ),
    },
    {
        label: 'Domain',
        icon: (
            <svg className="size-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10" />
                <path d="M2 12h20" />
                <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
            </svg>
        ),
    },
    {
        label: 'Configure Site',
        icon: (
            <svg className="size-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="3" />
                <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
            </svg>
        ),
    },
    {
        label: 'Execute',
        icon: (
            <svg className="size-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="22 7 13.5 15.5 8.5 10.5 2 17" />
                <polyline points="16 7 22 7 22 13" />
            </svg>
        ),
    },
]

export default function SiteBuilderWizard() {
    const [currentStep, setCurrentStep] = useState(0)
    const [mode, setMode] = useState<SiteBuilderMode | null>(null)
    const [selectedTokenId, setSelectedTokenId] = useState<string | null>(null)
    const [selectedExistingSiteId, setSelectedExistingSiteId] = useState<string | null>(null)
    const [presetTemplateName, setPresetTemplateName] = useState<string | undefined>(undefined)
    const [domainReady, setDomainReady] = useState(false)
    const [config, setConfig] = useState(defaultSiteBuilderConfig())

    function onModeSelect(nextMode: SiteBuilderMode) {
        if (nextMode !== mode) {
            // Switching modes invalidates whatever was picked under the old one — start clean.
            setSelectedTokenId(null)
            setSelectedExistingSiteId(null)
            setPresetTemplateName(undefined)
            setDomainReady(false)
            setConfig(defaultSiteBuilderConfig())
        }
        setMode(nextMode)
    }

    function onTokenSelect(token: TokenMint) {
        setSelectedTokenId(token.id ?? null)
        setConfig((prev) => prev.copyWith({
            token: {
                id: token.id,
                mint_public_key: token.mint_public_key,
                token_name: token.token_name,
                token_symbol: token.token_symbol,
                logo_url: token.logo_url,
            },
        }))
    }

    function onTokenClear() {
        setSelectedTokenId(null)
        setConfig((prev) => prev.copyWith({ token: null }))
    }

    function onExistingSiteSelect(site: MockExistingSite) {
        setSelectedExistingSiteId(site.id)
        setSelectedTokenId(site.tokenId)
        setPresetTemplateName(site.templateName)
        setDomainReady(false)
        setConfig((prev) => prev.copyWith({
            token: {
                id: site.tokenId,
                mint_public_key: site.tokenMintPublicKey,
                token_name: site.tokenName,
                token_symbol: site.tokenSymbol,
                logo_url: site.logoUrl,
            },
            template: null,
            domainMode: site.domainMode,
            subdomain: site.subdomain,
            customDomain: site.customDomain,
            siteTitle: site.siteTitle,
            tagline: site.tagline,
            accentColor: site.accentColor,
        }))
    }

    const canAdvance = [
        mode !== null,
        mode === 'edit' ? selectedExistingSiteId !== null : selectedTokenId !== null,
        config.template !== null,
        domainReady,
        true,
        false,
    ]

    return (
        <div className="w-full flex flex-col gap-8">
            <h1 className="text-2xl font-semibold">Token Site Builder Wizard</h1>

            {/* Progress bar */}
            <div className="w-full flex items-center">
                {steps.map((step, i) => {
                    const isDone = i < currentStep
                    const isActive = i === currentStep
                    const isUpcoming = i > currentStep

                    return (
                        <div key={i} className="flex-1 flex items-center">
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
                                    {i === 1 && mode === 'edit' ? 'Existing Site' : step.label}
                                </span>
                            </div>

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
                    <SiteStart mode={mode} onSelect={onModeSelect} />
                )}
                {currentStep === 1 && (
                    mode === 'edit' ? (
                        <SiteExistingSelect selectedSiteId={selectedExistingSiteId} onSelect={onExistingSiteSelect} />
                    ) : (
                        <LaunchTokenSelect selectedId={selectedTokenId} onSelect={onTokenSelect} onClear={onTokenClear} />
                    )
                )}
                {currentStep === 2 && (
                    <SiteTemplateSelect
                        selectedTemplate={config.template}
                        onSelect={(template) => setConfig((prev) => prev.copyWith({ template }))}
                        initialTemplateName={presetTemplateName}
                    />
                )}
                {currentStep === 3 && (
                    <SiteDomainSetup
                        config={config}
                        onDomainModeChange={(domainMode) => setConfig((prev) => prev.copyWith({ domainMode }))}
                        onSubdomainChange={(subdomain) => setConfig((prev) => prev.copyWith({ subdomain }))}
                        onCustomDomainChange={(customDomain) => setConfig((prev) => prev.copyWith({ customDomain }))}
                        onReadyChange={setDomainReady}
                    />
                )}
                {currentStep === 4 && (
                    <SiteConfig
                        config={config}
                        onSiteTitleChange={(siteTitle) => setConfig((prev) => prev.copyWith({ siteTitle }))}
                        onTaglineChange={(tagline) => setConfig((prev) => prev.copyWith({ tagline }))}
                        onAccentColorChange={(accentColor) => setConfig((prev) => prev.copyWith({ accentColor }))}
                    />
                )}
                {currentStep === 5 && (
                    <SiteExecute config={config} />
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
                    disabled={currentStep === steps.length - 1 || !canAdvance[currentStep]}
                    className="px-3 py-1.5 text-sm rounded border border-blue-500 bg-blue-500 text-white hover:bg-blue-600 hover:border-blue-600 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                >
                    {nextButtonLabel(currentStep, mode)}
                </button>
            </div>
        </div>
    )
}
