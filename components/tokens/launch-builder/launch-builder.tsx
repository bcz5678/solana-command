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
import { buildLaunchProfile, applyLaunchProfile, type LaunchProfile } from './launch-profile'

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
    const [configNodeId, setConfigNodeId]  = useState<string | null>(null)
    const [profileName, setProfileName]    = useState('Untitled Launch')
    const [configId, setConfigId]          = useState<string | null>(null)

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

    // ── API callbacks ─────────────────────────────────────────────────────────

    const onSave = useCallback(async (): Promise<string | null> => {
        const launchTypeNode = nodes.find(
            (n) => (n.data as unknown as BuilderNodeData).category === 'launchType',
        )
        const launchType = launchTypeNode
            ? (launchTypeNode.data as unknown as BuilderNodeData).subtype
            : null

        const tokenNode = nodes.find(
            (n) => (n.data as unknown as BuilderNodeData).category === 'token',
        )
        const tokenMintId =
            (tokenNode
                ? ((tokenNode.data as unknown as BuilderNodeData).config?.tokenMint as string)
                : null) ?? null

        try {
            const res = await fetch('/api/launch-builder/config/save', {
                method:  'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    id:          configId,
                    name:        profile.name,
                    description: profile.description,
                    launchType,
                    graph:       profile,
                    settings:    {},
                    tokenMintId,
                    status:      'draft',
                }),
            })
            if (!res.ok) return null
            const data = await res.json()
            const newId: string | null = data?.id ?? data?.config_id ?? null
            if (newId) setConfigId(newId)
            return newId
        } catch {
            return null
        }
    }, [nodes, profile, configId])

    const onSaveAsTemplate = useCallback(async (): Promise<boolean> => {
        const launchType = profile.nodes.find((n) => n.category === 'launchType')?.subtype ?? 'dev0DevOnly'
        try {
            const res = await fetch('/api/launch-builder/template/save', {
                method:  'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    name:        profile.name,
                    description: profile.description,
                    launchType,
                    graph:       profile,
                    settings:    {},
                }),
            })
            return res.ok
        } catch {
            return false
        }
    }, [profile])

    const onLoadProfile = useCallback(
        (loadedProfile: LaunchProfile, name: string) => {
            const { nodes: newNodes, edges: newEdges } = applyLaunchProfile(
                loadedProfile,
                (id) => ({
                    onConfigure: () => onConfigureNode(id),
                    onDelete:    () => onDeleteNode(id),
                }),
            )
            setNodes(newNodes)
            setEdges(newEdges)
            setProfileName(name)
            setConfigId(null)
            setConfigNodeId(null)
        },
        [onConfigureNode, onDeleteNode, setNodes, setEdges],
    )

    // ─────────────────────────────────────────────────────────────────────────

    const configNode = nodes.find((n) => n.id === configNodeId) ?? null

    return (
        <div className="flex h-[calc(100vh-3rem)] w-full min-w-0 flex-col">
            <LaunchBuilderToolbar
                profileName={profileName}
                onProfileNameChange={setProfileName}
                profile={profile}
                onSave={onSave}
                onSaveAsTemplate={onSaveAsTemplate}
                onLoadProfile={onLoadProfile}
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
                    edges={edges}
                    onOpenChange={(open) => { if (!open) setConfigNodeId(null) }}
                    onSave={onSaveConfig}
                />
            </div>
        </div>
    )
}
