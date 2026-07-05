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
import ExecutionNode from './nodes/execution-node'
import TokenNode from './nodes/token-node'
import LaunchTypeNode from './nodes/launch-type-node'
import TradeNode from './nodes/trade-node'
import TriggerNode from './nodes/trigger-node'
import ConditionalNode from './nodes/conditional-node'
import DataNode from './nodes/data-node'
import WebhookNode from './nodes/webhook-node'
import NoOpNode from './nodes/no-op-node'
import DeletableEdge from './edges/deletable-edge'
import { CATEGORY_LABELS, SINGLE_INSTANCE_CATEGORIES } from './node-palette-config'
import { PaletteNodeDef, BuilderNodeData } from './types'
import { isCompatibleConnection, getNodeOutputTypes } from './handle-types'

const nodeTypes = {
    executionNode: ExecutionNode,
    tokenNode: TokenNode,
    launchTypeNode: LaunchTypeNode,
    tradeNode: TradeNode,
    triggerNode: TriggerNode,
    conditionalNode: ConditionalNode,
    dataNode: DataNode,
    webhookNode: WebhookNode,
    noOpNode: NoOpNode,
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

    const isValidConnection = useCallback(
        (connection: Edge | { source: string; target: string; sourceHandle?: string | null; targetHandle?: string | null }) => {
            const sourceNode = nodes.find((n) => n.id === connection.source)
            const targetNode = nodes.find((n) => n.id === connection.target)
            if (!sourceNode || !targetNode) return false
            const srcData = sourceNode.data as unknown as BuilderNodeData
            const tgtData = targetNode.data as unknown as BuilderNodeData
            const outTypes = getNodeOutputTypes(srcData)
            const inTypes  = tgtData.inputTypes ?? []
            let outputIdx = 0
            if (connection.sourceHandle?.startsWith('output-')) {
                outputIdx = parseInt(connection.sourceHandle.replace('output-', ''), 10)
            }
            const srcType = outTypes[outputIdx]
            // "exec-in" is the universal manual-start pin every node exposes alongside
            // its normal typed input — it isn't part of that node's declared inputTypes.
            const tgtType = connection.targetHandle === 'exec-in' ? 'exec' : inTypes[0]
            if (!srcType || !tgtType) return false
            return isCompatibleConnection(srcType, tgtType)
        },
        [nodes],
    )

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
                inputTypes: item.inputTypes,
                outputTypes: item.outputTypes,
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
                isValidConnection={isValidConnection}
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
