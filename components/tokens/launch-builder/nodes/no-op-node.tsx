'use client'

import type { NodeProps } from '@xyflow/react'
import { ArrowRight } from 'lucide-react'
import BaseNodeShell from './base-node-shell'
import { BuilderNodeData } from '../types'

export default function NoOpNode({ data, selected }: NodeProps) {
    const d = data as unknown as BuilderNodeData

    return (
        <BaseNodeShell
            icon={ArrowRight}
            category="utility"
            label={d.label}
            displayName={d.displayName}
            onRename={d.onRename}
            subLabel="Passthrough — no effect"
            inputs={1}
            outputCount={1}
            inputTypes={d.inputTypes}
            outputTypes={d.outputTypes}
            selected={selected}
            onConfigure={d.onConfigure}
            onDelete={d.onDelete}
        />
    )
}
