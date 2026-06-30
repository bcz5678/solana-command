'use client'

import { useCallback, useState } from 'react'
import {
    ReactFlow,
    Background,
    Controls,
    MiniMap,
    useReactFlow,
    type Node,
    type Edge,
    type OnNodesChange,
    type OnEdgesChange,
    type OnConnect,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogDescription,
    DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import TokenNode from './nodes/token-node'
import LaunchTypeNode from './nodes/launch-type-node'
import TradeNode from './nodes/trade-node'
import TriggerNode from './nodes/trigger-node'
import ConditionalNode from './nodes/conditional-node'
import DeletableEdge from './edges/deletable-edge'
import { CATEGORY_LABELS, SINGLE_INSTANCE_CATEGORIES } from './node-palette-config'
import { PaletteNodeDef, BuilderNodeData } from './types'

const nodeTypes = {
    tokenNode: TokenNode,
    launchTypeNode: LaunchTypeNode,
    tradeNode: TradeNode,
    triggerNode: TriggerNode,
    conditionalNode: ConditionalNode,
}

const edgeTypes = {
    deletable: DeletableEdge,
}

const defaultEdgeOptions = { type: 'deletable' }

type Props = {
    nodes: Node[]
    edges: Edge[]
    onNodesChange: OnNodesChange
    onEdgesChange: OnEdgesChange
    onConnect: OnConnect
    onAddNode: (node: Node) => void
    onConfigureNode: (nodeId: string) => void
    onDeleteNode: (nodeId: string) => void
}

export default function LaunchBuilderCanvas({
    nodes,
    edges,
    onNodesChange,
    onEdgesChange,
    onConnect,
    onAddNode,
    onConfigureNode,
    onDeleteNode,
}: Props) {
    const { screenToFlowPosition } = useReactFlow()
    const [duplicateCategory, setDuplicateCategory] = useState<PaletteNodeDef['category'] | null>(null)

    const onDragOver = useCallback((event: React.DragEvent) => {
        event.preventDefault()
        event.dataTransfer.dropEffect = 'move'
    }, [])

    const onDrop = useCallback(
        (event: React.DragEvent) => {
            event.preventDefault()
            const raw = event.dataTransfer.getData('application/launch-builder-node')
            if (!raw) return

            const item: PaletteNodeDef = JSON.parse(raw)

            if (
                SINGLE_INSTANCE_CATEGORIES.includes(item.category) &&
                nodes.some((n) => (n.data as unknown as BuilderNodeData).category === item.category)
            ) {
                setDuplicateCategory(item.category)
                return
            }

            const position = screenToFlowPosition({ x: event.clientX, y: event.clientY })
            const id = crypto.randomUUID()

            const data: BuilderNodeData = {
                category: item.category,
                subtype: item.subtype,
                label: item.label,
                config: { ...(item.defaultData ?? {}) },
                onConfigure: () => onConfigureNode(id),
                onDelete: () => onDeleteNode(id),
            }

            onAddNode({ id, type: item.nodeType, position, data })
        },
        [nodes, screenToFlowPosition, onAddNode, onConfigureNode, onDeleteNode],
    )

    return (
        <div className="h-full w-full flex-1">
            <ReactFlow
                nodes={nodes}
                edges={edges}
                nodeTypes={nodeTypes}
                edgeTypes={edgeTypes}
                defaultEdgeOptions={defaultEdgeOptions}
                onNodesChange={onNodesChange}
                onEdgesChange={onEdgesChange}
                onConnect={onConnect}
                onDrop={onDrop}
                onDragOver={onDragOver}
                defaultViewport={{ x: 0, y: 0, zoom: 1.0 }}
                minZoom={0.2}
                maxZoom={1.5}
            >
                <Background />
                <Controls />
                <MiniMap pannable zoomable />
            </ReactFlow>

            <Dialog open={!!duplicateCategory} onOpenChange={(open) => { if (!open) setDuplicateCategory(null) }}>
                <DialogContent className="sm:max-w-sm">
                    <DialogHeader>
                        <DialogTitle>Only one {duplicateCategory ? CATEGORY_LABELS[duplicateCategory] : ''} node allowed</DialogTitle>
                        <DialogDescription>
                            The canvas can only have one {duplicateCategory ? CATEGORY_LABELS[duplicateCategory] : ''} node at a time.
                            Remove the existing one before adding another.
                        </DialogDescription>
                    </DialogHeader>
                    <DialogFooter>
                        <Button onClick={() => setDuplicateCategory(null)}>Got it</Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    )
}
