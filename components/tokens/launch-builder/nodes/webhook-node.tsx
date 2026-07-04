'use client'

import type { NodeProps } from '@xyflow/react'
import { Webhook } from 'lucide-react'
import BaseNodeShell from './base-node-shell'
import { BuilderNodeData } from '../types'

export default function WebhookNode({ data, selected }: NodeProps) {
    const d = data as unknown as BuilderNodeData
    const url = d.config?.url as string | undefined

    let subLabel: string | undefined
    if (url) {
        try {
            const parsed = new URL(url)
            subLabel = parsed.hostname + (parsed.pathname !== '/' ? parsed.pathname : '')
        } catch {
            subLabel = url.slice(0, 32) + (url.length > 32 ? '…' : '')
        }
    }

    return (
        <BaseNodeShell
            icon={Webhook}
            category="utility"
            label={d.label}
            displayName={d.displayName}
            onRename={d.onRename}
            subLabel={subLabel ?? 'No URL configured'}
            inputs={1}
            outputCount={1}
            inputTypes={d.inputTypes}
            outputTypes={d.outputTypes}
            selected={selected}
            onConfigure={d.onConfigure}
            onDelete={d.onDelete}
            resultBadge={d.webhookResult}
        />
    )
}
