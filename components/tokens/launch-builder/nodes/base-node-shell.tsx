'use client'

import { Handle, Position } from '@xyflow/react'
import { Settings2, Trash2, LucideIcon } from 'lucide-react'
import { Card } from '@/components/ui/card'
import { BuilderNodeCategory } from '../types'
import { CATEGORY_ACCENT } from '../node-palette-config'

type Props = {
    icon: LucideIcon
    category: BuilderNodeCategory
    label: string
    subLabel?: string
    inputs: 0 | 1
    outputCount: number
    outputLabels?: string[]
    selected?: boolean
    onConfigure?: () => void
    onDelete?: () => void
}

export default function BaseNodeShell({
    icon: Icon,
    category,
    label,
    subLabel,
    inputs,
    outputCount,
    outputLabels,
    selected,
    onConfigure,
    onDelete,
}: Props) {
    const accent = CATEGORY_ACCENT[category]

    return (
        <div className="relative">
            {onDelete && (
                <button
                    type="button"
                    onClick={onDelete}
                    title="Delete node"
                    className="nodrag absolute -top-2.5 -right-2.5 z-10 flex size-5 items-center justify-center rounded-full border border-border bg-card text-muted-foreground shadow-sm transition-colors hover:border-destructive hover:bg-destructive/10 hover:text-destructive"
                >
                    <Trash2 className="size-2.5" />
                </button>
            )}

            <Card
                className={[
                    'w-56 border-l-4 py-2.5 transition-colors',
                    accent.border,
                    selected ? `ring-2 ring-offset-1 ring-offset-background ${accent.border.replace('border-', 'ring-')}` : '',
                ].join(' ')}
                onDoubleClick={(e) => { e.stopPropagation(); onConfigure?.() }}
            >
                <div className="flex items-center gap-2 px-3">
                    <span className={['flex size-6 shrink-0 items-center justify-center rounded-md', accent.bg].join(' ')}>
                        <Icon className={['size-3.5', accent.text].join(' ')} />
                    </span>
                    <div className="flex min-w-0 flex-1 flex-col">
                        <span className="truncate text-xs font-medium leading-tight">{label}</span>
                        {subLabel && (
                            <span className="truncate text-[10px] text-muted-foreground leading-tight">{subLabel}</span>
                        )}
                    </div>
                    {onConfigure && (
                        <button
                            type="button"
                            onClick={onConfigure}
                            title="Configure"
                            className="nodrag flex shrink-0 items-center justify-center rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
                        >
                            <Settings2 className="size-3.5" />
                        </button>
                    )}
                </div>

                {inputs === 1 && (
                    <Handle
                        type="target"
                        position={Position.Top}
                        className={['size-2.5! border-2! bg-background! outline-2! outline-offset-1! outline-border', accent.border].join(' ')}
                    />
                )}

                {outputCount === 1 && (
                    <Handle
                        type="source"
                        position={Position.Bottom}
                        className={['size-2.5! border-2! bg-background! outline-2! outline-offset-1! outline-border', accent.border].join(' ')}
                    />
                )}

                {outputCount > 1 && Array.from({ length: outputCount }).map((_, i) => {
                    const leftPct = ((i + 1) / (outputCount + 1)) * 100
                    return (
                        <Handle
                            key={i}
                            id={`output-${i}`}
                            type="source"
                            position={Position.Bottom}
                            style={{ left: `${leftPct}%` }}
                            className={['size-2.5! border-2! bg-background! outline-2! outline-offset-1! outline-border', accent.border].join(' ')}
                        >
                            {outputLabels?.[i] && (
                                <span className="pointer-events-none absolute top-3.5 left-1/2 -translate-x-1/2 whitespace-nowrap text-[9px] text-muted-foreground">
                                    {outputLabels[i]}
                                </span>
                            )}
                        </Handle>
                    )
                })}
            </Card>
        </div>
    )
}
