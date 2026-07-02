'use client'

import type { NodeProps } from '@xyflow/react'
import { Coins } from 'lucide-react'
import BaseNodeShell from './base-node-shell'
import { BuilderNodeData } from '../types'

export default function TokenNode({ data, selected }: NodeProps) {
    const d = data as unknown as BuilderNodeData
    const symbol = d.config?.tokenSymbol as string | undefined

    return (
        <BaseNodeShell
            icon={Coins}
            category="token"
            label={d.label}
            subLabel={symbol ? `${symbol}` : 'No token selected'}
            inputs={0}
            outputCount={1}
            inputTypes={d.inputTypes}
            outputTypes={d.outputTypes}
            selected={selected}
            onConfigure={d.onConfigure}
            onDelete={d.onDelete}
        />
    )
}
