'use client'

import { useState } from 'react'
import BundleTradesWizard   from '@/components/tokens/strategy-trade/wizards/bundle-trades-wizard'
import StaggeredBuyWizard   from '@/components/tokens/strategy-trade/wizards/staggered-buy-wizard'
import NaturalVolumeWizard  from '@/components/tokens/strategy-trade/wizards/natural-volume-wizard'
import TrendingVolumeWizard from '@/components/tokens/strategy-trade/wizards/trending-volume-wizard'
import HoldersMakerWizard   from '@/components/tokens/strategy-trade/wizards/holders-maker-wizard'

type StrategyKey = 'bundle' | 'staggered' | 'natural' | 'trending' | 'holders'

const strategies: { key: StrategyKey; label: string; description: string }[] = [
    { key: 'bundle',    label: 'Bundle Trades',   description: 'Execute coordinated multi-wallet buys in a single bundle' },
    { key: 'staggered', label: 'Staggered Buy',   description: 'Spread purchases across time to reduce price impact' },
    { key: 'natural',   label: 'Natural Volume',  description: 'Generate organic-looking trading volume patterns' },
    { key: 'trending',  label: 'Trending Volume', description: 'Boost volume to push a token into trending lists' },
    { key: 'holders',   label: 'Holders Maker',   description: 'Distribute tokens to grow the unique holder count' },
]

const wizards: Record<StrategyKey, React.ComponentType> = {
    bundle:    BundleTradesWizard,
    staggered: StaggeredBuyWizard,
    natural:   NaturalVolumeWizard,
    trending:  TrendingVolumeWizard,
    holders:   HoldersMakerWizard,
}

export default function StrategyTradePage() {
    const [active, setActive] = useState<StrategyKey | null>(null)

    if (active) {
        const Wizard = wizards[active]
        const meta   = strategies.find(s => s.key === active)!
        return (
            <div className="flex flex-col gap-6 p-6 w-full min-h-0">
                <div className="flex items-center gap-3">
                    <button
                        onClick={() => setActive(null)}
                        className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
                    >
                        <span className="text-base leading-none">←</span>
                        Strategies
                    </button>
                    <span className="text-muted-foreground/40">/</span>
                    <span className="text-sm font-semibold">{meta.label}</span>
                </div>
                <Wizard />
            </div>
        )
    }

    return (
        <div className="flex flex-col gap-6 p-6 w-full min-h-0">
            <h2 className="text-sm font-semibold">Choose a Strategy</h2>
            <div className="grid grid-cols-1 gap-3">
                {strategies.map(s => (
                    <button
                        key={s.key}
                        onClick={() => setActive(s.key)}
                        className="flex flex-col gap-1 text-left rounded-xl border border-border bg-card px-5 py-4 hover:bg-accent hover:border-accent-foreground/20 transition-colors cursor-pointer"
                    >
                        <span className="text-sm font-semibold">{s.label}</span>
                        <span className="text-xs text-muted-foreground">{s.description}</span>
                    </button>
                ))}
            </div>
        </div>
    )
}
