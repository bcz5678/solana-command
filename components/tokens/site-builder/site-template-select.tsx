'use client'

import LaunchSelectCard from '@/components/tokens/launch/launch-select-card'
import { SiteTemplate } from './types'

type Props = {
    selectedTemplate: SiteTemplate
    onSelect: (template: SiteTemplate) => void
}

const cards = [
    {
        template: SiteTemplate.minimal,
        title: 'Minimal',
        description: 'Clean single-page layout — logo, ticker, contract address, and social links. Fastest to configure.',
    },
    {
        template: SiteTemplate.memeLanding,
        title: 'Meme Landing',
        description: 'High-energy landing page with hero art, meme gallery, and a live price/market-cap ticker.',
    },
    {
        template: SiteTemplate.proTrader,
        title: 'Pro Trader',
        description: 'Chart-forward layout with holder stats, tokenomics breakdown, and embedded DEX widgets.',
    },
]

export default function SiteTemplateSelect({ selectedTemplate, onSelect }: Props) {
    return (
        <div className="w-full flex flex-col gap-4">
            <div className="flex flex-row gap-4 w-full">
                {cards.map(({ template, title, description }) => (
                    <button
                        key={template}
                        className={[
                            'flex-1 flex flex-col h-full text-left rounded-lg transition-all',
                            'active:scale-[0.99]',
                            selectedTemplate === template
                                ? 'ring-2 ring-blue-500'
                                : 'hover:ring-2 hover:ring-blue-400/50',
                        ].join(' ')}
                        onClick={() => onSelect(template)}
                    >
                        <LaunchSelectCard
                            title={title}
                            description={description}
                            isSelected={selectedTemplate === template}
                        />
                    </button>
                ))}
            </div>
        </div>
    )
}
