'use client'

import type { NodeProps } from '@xyflow/react'
import BN from 'bn.js'
import BaseNodeShell from './base-node-shell'
import { BuilderNodeData } from '../types'
import { PALETTE_ITEMS } from '../node-palette-config'
import { lamportsBNToSolDisplay } from '@/lib/lamports'

export default function LaunchTypeNode({ data, selected }: NodeProps) {
    const d = data as unknown as BuilderNodeData
    const def = PALETTE_ITEMS.find((i) => i.subtype === d.subtype)

    const walletTrades = d.config?.walletTrades as { walletId: string }[] | undefined
    const totalSOLInLamports = d.config?.totalSOLInLamports as string | undefined

    let subLabel: string | undefined
    if (walletTrades?.length) {
        const totalSol = totalSOLInLamports ? lamportsBNToSolDisplay(new BN(totalSOLInLamports)) : '0'
        subLabel = `${walletTrades.length} buyer${walletTrades.length !== 1 ? 's' : ''} · ${totalSol} SOL`
    }

    return (
        <BaseNodeShell
            icon={def?.icon ?? PALETTE_ITEMS[0].icon}
            category="launchType"
            label={d.label}
            displayName={d.displayName}
            onRename={d.onRename}
            subLabel={subLabel}
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
