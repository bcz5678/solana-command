'use client'

import type { NodeProps } from '@xyflow/react'
import BaseNodeShell from './base-node-shell'
import { BuilderNodeData } from '../types'
import { PALETTE_ITEMS } from '../node-palette-config'

function subLabelFor(data: BuilderNodeData): string | undefined {
    switch (data.subtype) {
        case 'timerSet':
            return `${data.config?.seconds ?? 5}s`
        case 'timerRandomInterval':
            return `${data.config?.minSeconds ?? 5}s – ${data.config?.maxSeconds ?? 30}s`
        case 'humanInTheLoop':
            return (data.config?.instructions as string) || 'Waits for manual continue'
        default:
            return undefined
    }
}

export default function TriggerNode({ data, selected }: NodeProps) {
    const d = data as unknown as BuilderNodeData
    const def = PALETTE_ITEMS.find((i) => i.subtype === d.subtype)

    return (
        <BaseNodeShell
            icon={def?.icon ?? PALETTE_ITEMS[0].icon}
            category="trigger"
            label={d.label}
            subLabel={subLabelFor(d)}
            inputs={1}
            outputCount={1}
            selected={selected}
            onConfigure={d.onConfigure}
            onDelete={d.onDelete}
        />
    )
}
