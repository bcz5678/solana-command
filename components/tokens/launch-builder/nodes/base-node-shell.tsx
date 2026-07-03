'use client'

import { Handle, Position } from '@xyflow/react'
import { Settings2, Trash2, Play, LucideIcon } from 'lucide-react'
import { Card } from '@/components/ui/card'
import { BuilderNodeCategory, HandleDataType } from '../types'
import { CATEGORY_ACCENT } from '../node-palette-config'
import { HANDLE_TYPE_META } from '../handle-types'

type Props = {
    icon: LucideIcon
    category: BuilderNodeCategory
    label: string
    subLabel?: string
    inputs: 0 | 1
    outputCount: number
    outputLabels?: string[]
    inputTypes?: HandleDataType[]
    outputTypes?: HandleDataType[]
    /** Renders the universal "exec-in" pin so a Manual Execution node can attach here. Off for the Execution node itself. */
    allowExecInput?: boolean
    selected?: boolean
    onConfigure?: () => void
    onDelete?: () => void
    /** Manual Execution node only — triggers a visual dry-run walk downstream from this node. */
    onRun?: () => void
    /** Human In The Loop trigger only — dry-run engine is paused waiting on this node. */
    awaitingContinue?: boolean
    /** Human In The Loop trigger only — resumes a paused dry-run past this node. */
    onContinue?: () => void
}

export default function BaseNodeShell({
    icon: Icon,
    category,
    label,
    subLabel,
    inputs,
    outputCount,
    outputLabels,
    inputTypes,
    outputTypes,
    allowExecInput = true,
    selected,
    onConfigure,
    onDelete,
    onRun,
    awaitingContinue,
    onContinue,
}: Props) {
    const accent = CATEGORY_ACCENT[category]
    const inputHandleMeta  = HANDLE_TYPE_META[inputTypes?.[0]  ?? 'config']
    const outputHandleMeta = (i: number) => HANDLE_TYPE_META[outputTypes?.[i] ?? outputTypes?.[0] ?? 'config']
    const execHandleMeta   = HANDLE_TYPE_META.exec

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
                    awaitingContinue
                        ? 'ring-2 ring-offset-1 ring-offset-background ring-amber-500 animate-pulse'
                        : selected ? `ring-2 ring-offset-1 ring-offset-background ${accent.border.replace('border-', 'ring-')}` : '',
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
                    {onRun && (
                        <button
                            type="button"
                            onClick={onRun}
                            title="Run from here (visual dry-run)"
                            className="nodrag flex shrink-0 items-center justify-center rounded p-1 text-lime-500 hover:bg-lime-500/10 transition-colors"
                        >
                            <Play className="size-3.5" />
                        </button>
                    )}

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

                {awaitingContinue && (
                    <div className="px-3 pt-2">
                        <button
                            type="button"
                            onClick={onContinue}
                            className="nodrag flex w-full items-center justify-center gap-1.5 rounded-md border border-amber-500/40 bg-amber-500/10 px-2 py-1.5 text-xs font-medium text-amber-400 transition-colors hover:bg-amber-500/20"
                        >
                            <Play className="size-3" />
                            Continue
                        </button>
                    </div>
                )}

                {inputs === 1 && (
                    <Handle
                        id="data-in"
                        type="target"
                        position={Position.Top}
                        className={['size-2.5! border-2! bg-background! outline-2! outline-offset-1! outline-border', inputHandleMeta.border].join(' ')}
                    />
                )}

                {allowExecInput && (
                    <Handle
                        id="exec-in"
                        type="target"
                        position={Position.Left}
                        title="Manual execution start"
                        style={{ top: 16 }}
                        className={['size-2.5! border-2! bg-background! outline-2! outline-offset-1! outline-border', execHandleMeta.border].join(' ')}
                    />
                )}

                {outputCount === 1 && (
                    <Handle
                        type="source"
                        position={Position.Bottom}
                        className={['size-2.5! border-2! bg-background! outline-2! outline-offset-1! outline-border', outputHandleMeta(0).border].join(' ')}
                    />
                )}

                {outputCount > 1 && Array.from({ length: outputCount }).map((_, i) => {
                    const leftPct = ((i + 1) / (outputCount + 1)) * 100
                    const meta = outputHandleMeta(i)
                    return (
                        <Handle
                            key={i}
                            id={`output-${i}`}
                            type="source"
                            position={Position.Bottom}
                            style={{ left: `${leftPct}%` }}
                            className={['size-2.5! border-2! bg-background! outline-2! outline-offset-1! outline-border', meta.border].join(' ')}
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
