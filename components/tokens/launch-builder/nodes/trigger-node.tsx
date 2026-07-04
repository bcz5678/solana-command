'use client'

import type { NodeProps } from '@xyflow/react'
import BaseNodeShell from './base-node-shell'
import { BuilderNodeData } from '../types'
import { PALETTE_ITEMS } from '../node-palette-config'

function subLabelFor(data: BuilderNodeData): string | undefined {
    const dir = (data.config?.direction as string) === 'below' ? '≤' : '≥'
    switch (data.subtype) {
        case 'timerSet':
            return `${data.config?.seconds ?? 5}s`
        case 'timerRandomInterval':
            return `${data.config?.minSeconds ?? 5}s – ${data.config?.maxSeconds ?? 30}s`
        case 'humanInTheLoop':
            return (data.config?.instructions as string) || 'Waits for manual continue'
        case 'marketCapThreshold':
            return `${dir} $${Number(data.config?.targetMarketCapUSD ?? 50000).toLocaleString()}`
        case 'holderCountThreshold':
            return `${dir} ${Number(data.config?.targetHolderCount ?? 100).toLocaleString()} holders`
        case 'volumeThreshold':
            return `${dir} ${data.config?.targetVolumeSol ?? 10} SOL vol`
        case 'priceTarget':
            return `${dir} $${data.config?.targetPriceUSD ?? 0.001}`
        case 'retryBackoff':
            return `${data.config?.maxRetries ?? 3} retries · ${data.config?.initialDelaySeconds ?? 5}s base`
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
            displayName={d.displayName}
            onRename={d.onRename}
            subLabel={subLabelFor(d)}
            inputs={1}
            outputCount={1}
            inputTypes={d.inputTypes}
            outputTypes={d.outputTypes}
            selected={selected}
            onConfigure={d.onConfigure}
            onDelete={d.onDelete}
            awaitingContinue={d.awaitingContinue}
            onContinue={d.onContinue}
            countdown={d.runCountdown}
            resultBadge={d.executionResult}
        />
    )
}
