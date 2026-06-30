'use client'

import { useCallback, useMemo, useState } from 'react'
import {
    ReactFlowProvider,
    useNodesState,
    useEdgesState,
    addEdge,
    type Node,
    type Edge,
    type Connection,
} from '@xyflow/react'
import LaunchBuilderPalette from './launch-builder-palette'
import LaunchBuilderCanvas from './launch-builder-canvas'
import LaunchBuilderToolbar from './launch-builder-toolbar'
import NodeConfigDialog from './node-config-dialog'
import { BuilderNodeData } from './types'
import { buildLaunchProfile } from './launch-profile'

export default function LaunchBuilder() {
    return (
        <ReactFlowProvider>
            <LaunchBuilderInner />
        </ReactFlowProvider>
    )
}

function LaunchBuilderInner() {
    const [nodes, setNodes, onNodesChange] = useNodesState<Node>([])
    const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([])
    const [configNodeId, setConfigNodeId] = useState<string | null>(null)
    const [profileName, setProfileName] = useState('Untitled Launch')

    // Live JSON snapshot of the canvas — recomputed on every node/edge edit.
    // This is the object the future save/template/load API will persist.
    const profile = useMemo(
        () => buildLaunchProfile(nodes, edges, { name: profileName }),
        [nodes, edges, profileName],
    )

    const onConnect = useCallback(
        (connection: Connection) => setEdges((eds) => addEdge({ ...connection, type: 'deletable' }, eds)),
        [setEdges],
    )

    const onAddNode = useCallback(
        (node: Node) => setNodes((nds) => nds.concat(node)),
        [setNodes],
    )

    const onConfigureNode = useCallback((nodeId: string) => setConfigNodeId(nodeId), [])

    const onDeleteNode = useCallback(
        (nodeId: string) => {
            setNodes((nds) => nds.filter((n) => n.id !== nodeId))
            setEdges((eds) => eds.filter((e) => e.source !== nodeId && e.target !== nodeId))
            setConfigNodeId((current) => (current === nodeId ? null : current))
        },
        [setNodes, setEdges],
    )

    const onSaveConfig = useCallback(
        (nodeId: string, config: Record<string, unknown>) => {
            setNodes((nds) =>
                nds.map((n) => {
                    if (n.id !== nodeId) return n
                    const data = n.data as unknown as BuilderNodeData
                    return { ...n, data: { ...data, config } }
                }),
            )
        },
        [setNodes],
    )

    const configNode = nodes.find((n) => n.id === configNodeId) ?? null

    return (
        <div className="flex h-[calc(100vh-3rem)] w-full min-w-0 flex-col">
            <LaunchBuilderToolbar
                profileName={profileName}
                onProfileNameChange={setProfileName}
                profile={profile}
            />
            <div className="flex min-h-0 flex-1 w-full">
                <LaunchBuilderPalette nodes={nodes} />
                <LaunchBuilderCanvas
                    nodes={nodes}
                    edges={edges}
                    onNodesChange={onNodesChange}
                    onEdgesChange={onEdgesChange}
                    onConnect={onConnect}
                    onAddNode={onAddNode}
                    onConfigureNode={onConfigureNode}
                    onDeleteNode={onDeleteNode}
                />
                <NodeConfigDialog
                    node={configNode}
                    nodes={nodes}
                    onOpenChange={(open) => { if (!open) setConfigNodeId(null) }}
                    onSave={onSaveConfig}
                />
            </div>
        </div>
    )
}
