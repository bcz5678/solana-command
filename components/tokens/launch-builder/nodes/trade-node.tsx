'use client'

import type { NodeProps } from '@xyflow/react'
import BaseNodeShell from './base-node-shell'
import { BuilderNodeData } from '../types'
import { PALETTE_ITEMS } from '../node-palette-config'

export default function TradeNode({ data, selected }: NodeProps) {
    const d = data as unknown as BuilderNodeData
    const def = PALETTE_ITEMS.find((i) => i.subtype === d.subtype)
    const tokenSymbol = d.config?.tokenSymbol as string | undefined
    const walletCount = d.config?.selectedWalletIds as string[] | undefined
    const sellPct     = d.config?.sellPct as number | undefined

    const subLabelParts: string[] = []
    if (d.subtype === 'staggeredSell') {
        subLabelParts.push(sellPct != null ? `${sellPct}% sell` : 'Sell %?')
    } else if (tokenSymbol) {
        subLabelParts.push(tokenSymbol)
    }
    if (walletCount?.length) subLabelParts.push(`${walletCount.length} wallets`)

    return (
        <BaseNodeShell
            icon={def?.icon ?? PALETTE_ITEMS[0].icon}
            category="trade"
            label={d.label}
            subLabel={subLabelParts.length ? subLabelParts.join(' · ') : 'Not configured'}
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
