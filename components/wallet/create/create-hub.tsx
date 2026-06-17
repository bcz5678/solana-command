'use client'

import { useState } from 'react'
import { ArrowLeft, Shield, Layers } from 'lucide-react'
import CreateWalletsForm from './create-wallets-form'
import BulkCreateForm from './bulk-create-form'

type Mode = 'individual' | 'bulk'

const MODES: { id: Mode; icon: React.ElementType; title: string; description: string }[] = [
    {
        id:          'individual',
        icon:        Shield,
        title:       'Create Individual Wallet',
        description: 'Full BIP39 seed phrase ceremony — for primary or high-value wallets that need mnemonic recovery.',
    },
    {
        id:          'bulk',
        icon:        Layers,
        title:       'Bulk Wallets',
        description: 'Generate many wallets at once with password-only recovery — for trading pools and automation tasks.',
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

export default function CreateHub() {
    const [mode, setMode] = useState<Mode | null>(null)

    if (mode === 'individual') {
        return (
            <div>
                <BackButton onBack={() => setMode(null)} />
                <CreateWalletsForm />
            </div>
        )
    }

    if (mode === 'bulk') {
        return (
            <div>
                <BackButton onBack={() => setMode(null)} />
                <BulkCreateForm />
            </div>
        )
    }

    return (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 max-w-2xl">
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
