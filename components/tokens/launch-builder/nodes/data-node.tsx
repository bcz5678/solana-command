'use client'

import type { NodeProps } from '@xyflow/react'
import { Database } from 'lucide-react'
import BaseNodeShell from './base-node-shell'
import { BuilderNodeData } from '../types'

export default function DataNode({ data, selected }: NodeProps) {
    const d = data as unknown as BuilderNodeData
    const customFields = d.config?.customFields as { key: string; value: string }[] | undefined
    const customCount = customFields?.filter((f) => f.key.trim()).length ?? 0

    return (
        <BaseNodeShell
            icon={Database}
            category="utility"
            label={d.label}
            displayName={d.displayName}
            onRename={d.onRename}
            subLabel={customCount > 0 ? `+${customCount} custom field${customCount !== 1 ? 's' : ''}` : 'System fields only'}
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
