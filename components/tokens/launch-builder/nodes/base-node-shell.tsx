'use client'

import { useState } from 'react'
import { Handle, Position } from '@xyflow/react'
import { Settings2, Trash2, Play, Timer, CheckCircle2, XCircle, LucideIcon } from 'lucide-react'
import { Card } from '@/components/ui/card'
import { BuilderNodeCategory, HandleDataType } from '../types'
import { CATEGORY_ACCENT } from '../node-palette-config'
import { HANDLE_TYPE_META } from '../handle-types'

// Shape encodes handle ROLE (input / output / exec-in); color (from
// HANDLE_TYPE_META) encodes the data TYPE carried on the wire — the two are
// independent so a glance tells you both what a pin does and what flows through it.
const HANDLE_BASE  = 'size-2.5! border-2! bg-background! outline-2! outline-offset-1! outline-border'
const SHAPE_CIRCLE = 'rounded-full!'   // data input
const SHAPE_SQUARE = 'rounded-none!'   // exec-in

// Output pins are triangles. clip-path can't be used here — it crops the box
// but doesn't redraw a border along the new diagonal edges, so a clipped
// triangle ends up borderless on its two slanted sides. An SVG polygon with
// its own stroke draws a real border along every edge instead.
function OutputTriangleGlyph({ strokeClass }: { strokeClass: string }) {
    return (
        <svg viewBox="0 0 10 10" className="pointer-events-none absolute inset-0 size-full">
            <polygon
                points="1,1 9,1 5,9"
                strokeWidth={1.3}
                strokeLinejoin="round"
                className={['fill-background', strokeClass].join(' ')}
            />
        </svg>
    )
}

type Props = {
    icon: LucideIcon
    category: BuilderNodeCategory
    label: string
    /** User-set custom name for this node instance. Falls back to `label` when unset. */
    displayName?: string
    /** Renames this node instance (empty string clears back to the default type label). */
    onRename?: (name: string) => void
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
    /** Timer triggers only — whole seconds remaining while the dry-run engine counts down. */
    countdown?: number
    /** Webhook node only — result of the last dry-run POST. */
    resultBadge?: { ok: boolean; message: string }
}

export default function BaseNodeShell({
    icon: Icon,
    category,
    label,
    displayName,
    onRename,
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
    countdown,
    resultBadge,
}: Props) {
    const accent = CATEGORY_ACCENT[category]
    const inputHandleMeta  = HANDLE_TYPE_META[inputTypes?.[0]  ?? 'config']
    const outputHandleMeta = (i: number) => HANDLE_TYPE_META[outputTypes?.[i] ?? outputTypes?.[0] ?? 'config']
    const execHandleMeta   = HANDLE_TYPE_META.exec

    const [editingName, setEditingName] = useState(false)
    const [nameDraft, setNameDraft]     = useState(displayName ?? '')

    function startEditingName() {
        setNameDraft(displayName ?? '')
        setEditingName(true)
    }

    function commitName() {
        setEditingName(false)
        onRename?.(nameDraft.trim())
    }

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
                        : typeof countdown === 'number'
                            ? 'ring-2 ring-offset-1 ring-offset-background ring-lime-500 animate-pulse'
                            : selected ? `ring-2 ring-offset-1 ring-offset-background ${accent.ring}` : '',
                ].join(' ')}
                onDoubleClick={(e) => { e.stopPropagation(); onConfigure?.() }}
            >
                <div className="flex items-center gap-2 px-3">
                    <span className={['flex size-6 shrink-0 items-center justify-center rounded-md', accent.bg].join(' ')}>
                        <Icon className={['size-3.5', accent.text].join(' ')} />
                    </span>
                    <div className="flex min-w-0 flex-1 flex-col">
                        {editingName ? (
                            <input
                                autoFocus
                                value={nameDraft}
                                onChange={(e) => setNameDraft(e.target.value)}
                                onBlur={commitName}
                                onClick={(e) => e.stopPropagation()}
                                onKeyDown={(e) => {
                                    if (e.key === 'Enter') e.currentTarget.blur()
                                    if (e.key === 'Escape') { setNameDraft(displayName ?? ''); setEditingName(false) }
                                }}
                                className="nodrag w-full rounded-sm border border-border bg-background px-1 text-xs font-medium leading-tight outline-none"
                            />
                        ) : (
                            <button
                                type="button"
                                onClick={(e) => { e.stopPropagation(); startEditingName() }}
                                onDoubleClick={(e) => e.stopPropagation()}
                                title="Click to rename this step"
                                className="nodrag truncate text-left text-xs font-medium leading-tight decoration-dotted hover:underline"
                            >
                                {displayName || label}
                            </button>
                        )}
                        {displayName && (
                            <span className="truncate text-[10px] text-muted-foreground leading-tight">{label}</span>
                        )}
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

                {typeof countdown === 'number' && (
                    <div className="px-3 pt-2">
                        <div className="flex w-full items-center justify-center gap-1.5 rounded-md border border-lime-500/40 bg-lime-500/10 px-2 py-1.5 text-xs font-medium text-lime-400">
                            <Timer className="size-3" />
                            {countdown}s remaining
                        </div>
                    </div>
                )}

                {resultBadge && (
                    <div className="px-3 pt-2">
                        <div
                            className={[
                                'flex w-full items-start gap-1.5 rounded-md border px-2 py-1.5 text-[11px] font-medium',
                                resultBadge.ok
                                    ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-400'
                                    : 'border-destructive/40 bg-destructive/10 text-destructive',
                            ].join(' ')}
                        >
                            {resultBadge.ok ? (
                                <CheckCircle2 className="size-3 mt-0.5 shrink-0" />
                            ) : (
                                <XCircle className="size-3 mt-0.5 shrink-0" />
                            )}
                            <span className="break-words">{resultBadge.message}</span>
                        </div>
                    </div>
                )}

                {inputs === 1 && (
                    <Handle
                        id="data-in"
                        type="target"
                        position={Position.Top}
                        title="Input"
                        className={[HANDLE_BASE, SHAPE_CIRCLE, inputHandleMeta.border].join(' ')}
                    />
                )}

                {allowExecInput && (
                    <Handle
                        id="exec-in"
                        type="target"
                        position={Position.Left}
                        title="Manual execution start"
                        style={{ top: 16 }}
                        className={[HANDLE_BASE, SHAPE_SQUARE, execHandleMeta.border].join(' ')}
                    />
                )}

                {outputCount === 1 && (
                    <Handle
                        type="source"
                        position={Position.Bottom}
                        title="Output"
                        className="size-2.5! border-0! bg-transparent! p-0!"
                    >
                        <OutputTriangleGlyph strokeClass={outputHandleMeta(0).stroke} />
                    </Handle>
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
                            title="Output"
                            style={{ left: `${leftPct}%` }}
                            className="size-2.5! border-0! bg-transparent! p-0!"
                        >
                            <OutputTriangleGlyph strokeClass={meta.stroke} />
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
