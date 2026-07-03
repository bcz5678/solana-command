'use client'

import type { NodeProps } from '@xyflow/react'
import { Play } from 'lucide-react'
import BaseNodeShell from './base-node-shell'
import { BuilderNodeData } from '../types'

export default function ExecutionNode({ data, selected }: NodeProps) {
    const d = data as unknown as BuilderNodeData

    return (
        <BaseNodeShell
            icon={Play}
            category="execution"
            label={d.label}
            subLabel="Connect to any node’s left pin to start there"
            inputs={0}
            outputCount={1}
            allowExecInput={false}
            inputTypes={d.inputTypes}
            outputTypes={d.outputTypes}
            selected={selected}
            onConfigure={d.onConfigure}
            onDelete={d.onDelete}
            onRun={d.onRun}
        />
    )
}
