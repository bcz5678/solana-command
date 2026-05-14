'use client'

import LaunchSelectCard from '@/components/tokens/launch/launch-select-card';
import { LaunchType } from '@/components/tokens/launch/types';

type Props = {
    selectedType: LaunchType | null
    onSelect: (type: LaunchType) => void
}

const cards = [
    {
        type: LaunchType.block0,
        title: 'Block0 Launch',
        description: 'Allows a basic non-funded buy, a dev buy into block 0 and an option to bundle up to additional wallet addresses in the Jito bundle for block 0.',
    },
    {
        type: LaunchType.swarm,
        title: 'Swarm  Launch',
        description: 'TBD Post Block 0 swarm ',
    },
    {
        type: LaunchType.staggered,
        title: 'Staggered Launch',
        description: 'Organic-style launch with optional dev buy and block 0 bundles. Uses associated wallets for staggered buys at randomised intervals to appear more human.',
    },
]

export default function LaunchTypeSelect({ selectedType, onSelect }: Props) {
    return (
        <div className="w-full flex flex-col gap-4">
            <div className="flex flex-row gap-4 w-full">
                {cards.map(({ type, title, description }) => (
                    <button
                        key={type}
                        className={[
                            'flex-1 flex flex-col h-full text-left rounded-lg transition-all',
                            'active:scale-[0.99]',
                            selectedType === type
                                ? 'ring-2 ring-blue-500'
                                : 'hover:ring-2 hover:ring-blue-400/50',
                        ].join(' ')}
                        onClick={() => onSelect(type)}
                    >
                        <LaunchSelectCard
                            title={title}
                            description={description}
                            isSelected={selectedType === type}
                        />
                    </button>
                ))}
            </div>
        </div>
    )
}
