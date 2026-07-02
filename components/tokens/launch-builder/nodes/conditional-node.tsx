'use client'

import { useEffect } from 'react'
import { useUpdateNodeInternals, type NodeProps } from '@xyflow/react'
import BaseNodeShell from './base-node-shell'
import { BuilderNodeData } from '../types'
import { PALETTE_ITEMS } from '../node-palette-config'
import { getNodeOutputTypes } from '../handle-types'

function outputLabelsFor(data: BuilderNodeData): string[] {
    switch (data.subtype) {
        case 'loop':
            return ['Body', 'Done']
        case 'ifThen':
            return ['True', 'False']
        case 'switch':
            return (data.config?.branchLabels as string[]) ?? ['Case 1', 'Case 2']
        default:
            return []
    }
}

function outputCountFor(data: BuilderNodeData): number {
    if (data.subtype === 'switch') {
        return (data.config?.branchCount as number) ?? 2
    }
    return 2
}

export default function ConditionalNode({ id, data, selected }: NodeProps) {
    const d = data as unknown as BuilderNodeData
    const def = PALETTE_ITEMS.find((i) => i.subtype === d.subtype)
    const outputCount = outputCountFor(d)
    const updateNodeInternals = useUpdateNodeInternals()

    // Switch nodes can change their output handle count at runtime — xyflow needs
    // an explicit nudge to re-measure handle positions when that count changes.
    useEffect(() => {
        updateNodeInternals(id)
    }, [id, outputCount, updateNodeInternals])

    return (
        <BaseNodeShell
            icon={def?.icon ?? PALETTE_ITEMS[0].icon}
            category="conditional"
            label={d.label}
            inputs={1}
            outputCount={outputCount}
            outputLabels={outputLabelsFor(d)}
            inputTypes={d.inputTypes}
            outputTypes={getNodeOutputTypes(d)}
            selected={selected}
            onConfigure={d.onConfigure}
            onDelete={d.onDelete}
        />
    )
}
