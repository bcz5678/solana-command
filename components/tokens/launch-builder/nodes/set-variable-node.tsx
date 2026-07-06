'use client'

import type { NodeProps } from '@xyflow/react'
import { Braces } from 'lucide-react'
import BaseNodeShell from './base-node-shell'
import { BuilderNodeData } from '../types'

export default function SetVariableNode({ data, selected }: NodeProps) {
    const d = data as unknown as BuilderNodeData
    const variableName = (d.config?.variableName as string | undefined)?.trim()
    const walletCount = (d.config?.selectedWalletIds as string[] | undefined)?.length ?? 0

    return (
        <BaseNodeShell
            icon={Braces}
            category="utility"
            label={d.label}
            displayName={d.displayName}
            onRename={d.onRename}
            subLabel={variableName ? `{{${variableName}}} · ${walletCount} wallet${walletCount !== 1 ? 's' : ''}` : 'No variable name set'}
            inputs={1}
            outputCount={1}
            inputTypes={d.inputTypes}
            outputTypes={d.outputTypes}
            selected={selected}
            onConfigure={d.onConfigure}
            onDelete={d.onDelete}
            resultBadge={d.executionResult}
        />
    )
}
