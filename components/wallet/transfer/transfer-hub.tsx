'use client'

import { useState } from 'react'
import { ArrowLeft, Send, ArrowDownToLine, ArrowUpToLine, Users } from 'lucide-react'
import TransferForm from './transfer-form'
import FundOneToManyForm from './fund-one-to-many-form'
import SingleTransferForm from './single-transfer-form'
import ConsolidateForm from './consolidate-form'

type Mode = 'single' | 'fund' | 'fund-one-to-many' | 'consolidate'

const MODES: { id: Mode; icon: React.ElementType; title: string; description: string }[] = [
    {
        id:          'single',
        icon:        Send,
        title:       'Send to Single Wallet',
        description: 'Transfer SOL from one wallet to a single destination address.',
    },
    {
        id:          'fund',
        icon:        ArrowDownToLine,
        title:       'Fund Launch Wallets',
        description: 'Distribute SOL from one or more source wallets to multiple pool wallets.',
    },
    {
        id:          'fund-one-to-many',
        icon:        Users,
        title:       'Fund 1 to Many Wallets',
        description: 'Send SOL from a single source wallet to multiple destination wallets.',
    },
    {
        id:          'consolidate',
        icon:        ArrowUpToLine,
        title:       'Consolidate Wallets',
        description: 'Sweep SOL from multiple wallets back into a single destination.',
    },
]

function BackButton({ onBack }: { onBack: () => void }) {
    return (
        <button
            onClick={onBack}
            className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors mb-6"
        >
            <ArrowLeft className="size-3.5" />
            Back
        </button>
    )
}


export default function TransferHub() {
    const [mode, setMode] = useState<Mode | null>(null)

    if (mode === 'fund') {
        return (
            <div>
                <BackButton onBack={() => setMode(null)} />
                <TransferForm />
            </div>
        )
    }

    if (mode === 'fund-one-to-many') {
        return (
            <div>
                <BackButton onBack={() => setMode(null)} />
                <FundOneToManyForm />
            </div>
        )
    }

    if (mode === 'single') {
        return (
            <div>
                <BackButton onBack={() => setMode(null)} />
                <SingleTransferForm />
            </div>
        )
    }

    if (mode === 'consolidate') {
        return (
            <div>
                <BackButton onBack={() => setMode(null)} />
                <ConsolidateForm />
            </div>
        )
    }

    return (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {MODES.map(({ id, icon: Icon, title, description }) => (
                <button
                    key={id}
                    onClick={() => setMode(id)}
                    className="flex flex-col gap-3 rounded-lg border border-border p-5 text-left hover:border-foreground/30 hover:bg-muted/30 transition-colors"
                >
                    <span className="flex size-9 items-center justify-center rounded-md bg-muted">
                        <Icon className="size-4 text-foreground" />
                    </span>
                    <span className="flex flex-col gap-1">
                        <span className="text-sm font-medium">{title}</span>
                        <span className="text-xs text-muted-foreground leading-relaxed">{description}</span>
                    </span>
                </button>
            ))}
        </div>
    )
}
