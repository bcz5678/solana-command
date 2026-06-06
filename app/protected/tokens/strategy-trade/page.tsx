'use client'

import { useState } from 'react'
import type { TokenMint } from '@/lib/types/token-mint'
import StrategyTokenSelector from '@/components/tokens/strategy-trade/strategy-token-selector'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import BundleTradesWizard   from '@/components/tokens/strategy-trade/wizards/bundle-trades-wizard'
import StaggeredBuyWizard   from '@/components/tokens/strategy-trade/wizards/staggered-buy-wizard'
import NaturalVolumeWizard  from '@/components/tokens/strategy-trade/wizards/natural-volume-wizard'
import TrendingVolumeWizard from '@/components/tokens/strategy-trade/wizards/trending-volume-wizard'
import HoldersMakerWizard   from '@/components/tokens/strategy-trade/wizards/holders-maker-wizard'

export default function StrategyTradePage() {
    const [_selectedToken, setSelectedToken] = useState<TokenMint | null>(null)
    const [_mintAddress, setMintAddress]     = useState('')

    function handleTokenSelect(token: TokenMint | null, mint: string) {
        setSelectedToken(token)
        setMintAddress(mint)
    }

    return (
        <div className="flex flex-col gap-8 p-6 w-full min-h-0">

            {/* Token Selector */}
            <section className="flex flex-col gap-3">
                <h2 className="text-sm font-semibold">Token</h2>
                <StrategyTokenSelector onSelect={handleTokenSelect} />
            </section>

            {/* Strategy Tabs */}
            <section className="flex flex-col gap-3">
                <h2 className="text-sm font-semibold">Strategy</h2>
                <Tabs defaultValue="bundle">
                    <TabsList className="w-full h-auto">
                        <TabsTrigger value="bundle">Bundle Trades</TabsTrigger>
                        <TabsTrigger value="staggered">Staggered Buy</TabsTrigger>
                        <TabsTrigger value="natural">Natural Volume</TabsTrigger>
                        <TabsTrigger value="trending">Trending Volume</TabsTrigger>
                        <TabsTrigger value="holders">Holders Maker</TabsTrigger>
                    </TabsList>

                    <TabsContent value="bundle"    className="mt-4"><BundleTradesWizard /></TabsContent>
                    <TabsContent value="staggered" className="mt-4"><StaggeredBuyWizard /></TabsContent>
                    <TabsContent value="natural"   className="mt-4"><NaturalVolumeWizard /></TabsContent>
                    <TabsContent value="trending"  className="mt-4"><TrendingVolumeWizard /></TabsContent>
                    <TabsContent value="holders"   className="mt-4"><HoldersMakerWizard /></TabsContent>
                </Tabs>
            </section>

        </div>
    )
}
