'use client'

import { ReactNode } from 'react'

export type WizardStep = {
    label: string
    icon: ReactNode
}

type Props = {
    steps: WizardStep[]
    current: number
    onGoTo: (i: number) => void
    onBack: () => void
    onNext: () => void
    nextLabel?: string
    nextDisabled?: boolean
    children: ReactNode
}

function CheckIcon() {
    return (
        <svg className="size-3.5" viewBox="0 0 20 20" fill="currentColor">
            <path fillRule="evenodd" d="M16.707 5.293a1 1 0 00-1.414 0L8 12.586 4.707 9.293a1 1 0 00-1.414 1.414l4 4a1 1 0 001.414 0l8-8a1 1 0 000-1.414z" clipRule="evenodd" />
        </svg>
    )
}

export function StepPlaceholder({ title, description }: { title: string; description: string }) {
    return (
        <div className="min-h-48 rounded-lg border border-dashed border-border flex items-center justify-center">
            <div className="flex flex-col items-center gap-2 text-center px-8">
                <span className="text-sm font-medium">{title}</span>
                <span className="text-xs text-muted-foreground">{description}</span>
            </div>
        </div>
    )
}

export default function WizardShell({ steps, current, onGoTo, onBack, onNext, nextLabel, nextDisabled, children }: Props) {
    const isLast = current === steps.length - 1

    return (
        <div className="flex flex-col gap-6">
            {/* Step progress */}
            <div className="flex items-center">
                {steps.map((s, i) => {
                    const done   = i < current
                    const active = i === current
                    return (
                        <div key={i} className="flex-1 flex items-center">
                            <div className="flex flex-col items-center gap-1 shrink-0">
                                <button
                                    onClick={() => done && onGoTo(i)}
                                    disabled={i > current}
                                    className={[
                                        'flex items-center justify-center size-8 rounded-full border-2 transition-colors',
                                        done
                                            ? 'border-blue-500 bg-blue-500 text-white cursor-pointer hover:bg-blue-600'
                                            : active
                                            ? 'border-blue-500 bg-blue-500 text-white cursor-default'
                                            : 'border-muted-foreground/30 bg-muted text-muted-foreground/40 cursor-not-allowed',
                                    ].join(' ')}
                                >
                                    {done ? <CheckIcon /> : s.icon}
                                </button>
                                <span className={[
                                    'text-[10px] font-medium whitespace-nowrap',
                                    active ? 'text-blue-500' : done ? 'text-blue-400' : 'text-muted-foreground/40',
                                ].join(' ')}>
                                    {s.label}
                                </span>
                            </div>
                            {i < steps.length - 1 && (
                                <div className={`flex-1 h-0.5 mx-2 mb-4 transition-colors ${i < current ? 'bg-blue-500' : 'bg-muted-foreground/20'}`} />
                            )}
                        </div>
                    )
                })}
            </div>

            {/* Step content */}
            {children}

            {/* Navigation */}
            <div className="flex gap-2">
                <button
                    onClick={onBack}
                    disabled={current === 0}
                    className="px-3 py-1.5 text-sm rounded border border-border disabled:opacity-40"
                >
                    Back
                </button>
                <button
                    onClick={onNext}
                    disabled={isLast || nextDisabled}
                    className="px-3 py-1.5 text-sm rounded border border-blue-500 bg-blue-500 text-white hover:bg-blue-600 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                >
                    {nextLabel ?? (isLast ? 'Done' : current === steps.length - 2 ? 'Execute' : 'Next')}
                </button>
            </div>
        </div>
    )
}
