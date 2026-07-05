'use client'

import { BaseEdge, EdgeLabelRenderer, getSmoothStepPath, useReactFlow, type EdgeProps } from '@xyflow/react'
import { X } from 'lucide-react'

export default function DeletableEdge({
    id,
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
    style,
    markerEnd,
    selected,
}: EdgeProps) {
    const { setEdges } = useReactFlow()

    const [edgePath, labelX, labelY] = getSmoothStepPath({
        sourceX,
        sourceY,
        sourcePosition,
        targetX,
        targetY,
        targetPosition,
        borderRadius: 6,
    })

    function onDelete(event: React.MouseEvent) {
        event.stopPropagation()
        setEdges((eds) => eds.filter((e) => e.id !== id))
    }

    return (
        <>
            <BaseEdge
                id={id}
                path={edgePath}
                markerEnd={markerEnd}
                style={{ ...style, strokeWidth: selected ? 2.5 : 1.5 }}
            />
            <EdgeLabelRenderer>
                <button
                    type="button"
                    onClick={onDelete}
                    title="Delete connection"
                    className="nodrag nopan absolute flex size-4 items-center justify-center rounded-full border border-border bg-card text-muted-foreground shadow-sm transition-colors hover:border-destructive hover:text-destructive"
                    style={{
                        pointerEvents: 'all',
                        transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
                    }}
                >
                    <X className="size-2.5" />
                </button>
            </EdgeLabelRenderer>
        </>
    )
}
