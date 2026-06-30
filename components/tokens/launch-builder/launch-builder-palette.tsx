'use client'

import type { Node } from '@xyflow/react'
import {
    Accordion,
    AccordionItem,
    AccordionTrigger,
    AccordionContent,
} from '@/components/ui/accordion'
import { Card } from '@/components/ui/card'
import { CATEGORY_ACCENT, CATEGORY_LABELS, PALETTE_GROUPS, SINGLE_INSTANCE_CATEGORIES } from './node-palette-config'
import { BuilderNodeData, PaletteNodeDef } from './types'

function PaletteCard({ item, disabled }: { item: PaletteNodeDef; disabled: boolean }) {
    const accent = CATEGORY_ACCENT[item.category]
    const Icon = item.icon

    function onDragStart(event: React.DragEvent<HTMLDivElement>) {
        if (disabled) {
            event.preventDefault()
            return
        }
        event.dataTransfer.setData('application/launch-builder-node', JSON.stringify(item))
        event.dataTransfer.effectAllowed = 'move'
    }

    return (
        <Card
            draggable={!disabled}
            onDragStart={onDragStart}
            title={disabled ? `Only one ${CATEGORY_LABELS[item.category]} node is allowed on the canvas` : undefined}
            className={[
                'gap-1.5 border-l-4 py-2.5 transition-colors',
                accent.border,
                disabled
                    ? 'cursor-not-allowed opacity-40'
                    : 'cursor-grab hover:bg-muted/40 active:cursor-grabbing',
            ].join(' ')}
        >
            <div className="flex items-start gap-2 px-3">
                <span className={['mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-md', accent.bg].join(' ')}>
                    <Icon className={['size-3.5', accent.text].join(' ')} />
                </span>
                <div className="flex min-w-0 flex-col">
                    <span className="text-xs font-medium leading-tight">{item.label}</span>
                    <span className="text-[10px] text-muted-foreground leading-snug">
                        {disabled ? 'Already on canvas' : item.description}
                    </span>
                </div>
            </div>
        </Card>
    )
}

export default function LaunchBuilderPalette({ nodes }: { nodes: Node[] }) {
    const usedCategories = new Set(
        nodes
            .map((n) => (n.data as unknown as BuilderNodeData).category)
            .filter((category) => SINGLE_INSTANCE_CATEGORIES.includes(category)),
    )

    return (
        <div className="flex h-full w-72 shrink-0 flex-col gap-2 overflow-y-auto border-r border-border bg-card/40 p-3">
            <div className="px-1 pb-1">
                <h2 className="text-sm font-semibold">Node Palette</h2>
                <p className="text-[11px] text-muted-foreground">Drag a node onto the canvas to add it.</p>
            </div>
            <Accordion type="multiple" defaultValue={PALETTE_GROUPS.map((g) => g.category)}>
                {PALETTE_GROUPS.map((group) => (
                    <AccordionItem key={group.category} value={group.category}>
                        <AccordionTrigger className="px-1 text-xs uppercase tracking-wider text-muted-foreground">
                            {CATEGORY_LABELS[group.category]}
                        </AccordionTrigger>
                        <AccordionContent className="flex flex-col gap-2 px-1">
                            {group.items.map((item) => (
                                <PaletteCard
                                    key={item.subtype}
                                    item={item}
                                    disabled={usedCategories.has(item.category)}
                                />
                            ))}
                        </AccordionContent>
                    </AccordionItem>
                ))}
            </Accordion>
        </div>
    )
}
