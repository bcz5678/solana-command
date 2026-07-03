'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
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
import { getExecEntryNodeIds, getDownstreamNodeIds } from './handle-types'

const RUN_STEP_MS = 550

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

    // Kept in refs (not useCallback deps) so `runDryRun`'s identity stays
    // stable — node.data.onRun closures are created once at drop/load time
    // and must always see the latest edges/nodes, not a stale snapshot.
    const edgesRef = useRef<Edge[]>(edges)
    useEffect(() => { edgesRef.current = edges }, [edges])
    const nodesRef = useRef<Node[]>(nodes)
    useEffect(() => { nodesRef.current = nodes }, [nodes])

    // Resolves the Continue click for whichever Human In The Loop node(s) the
    // active dry-run session is currently paused on. Reassigned per run.
    const continueNodeRef = useRef<(nodeId: string) => void>(() => {})
    const onContinueNode = useCallback((nodeId: string) => continueNodeRef.current(nodeId), [])

    const runDryRun = useCallback(
        (execNodeId: string) => {
            const entryIds = getExecEntryNodeIds(execNodeId, edgesRef.current)
            if (entryIds.length === 0) return

            setNodes((nds) => nds.map((n) => ({ ...n, selected: false, data: { ...n.data, awaitingContinue: false } })))

            // Each branch walks independently on its own timer — a Human In The
            // Loop pause only blocks the branch it's on, not sibling branches
            // that forked off earlier (e.g. from a Switch/If-Then/Loop).
            const activeIds = new Set<string>()
            const hitlWaiting = new Map<string, () => void>()
            const visited = new Set<string>()

            const sync = () => setNodes((nds) => nds.map((n) => ({ ...n, selected: activeIds.has(n.id) })))
            const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))
            const waitForContinue = (nodeId: string) =>
                new Promise<void>((resolve) => {
                    hitlWaiting.set(nodeId, resolve)
                    setNodes((nds) => nds.map((n) => (n.id === nodeId ? { ...n, data: { ...n.data, awaitingContinue: true } } : n)))
                })

            continueNodeRef.current = (nodeId: string) => {
                const resolve = hitlWaiting.get(nodeId)
                if (!resolve) return
                hitlWaiting.delete(nodeId)
                setNodes((nds) => nds.map((n) => (n.id === nodeId ? { ...n, data: { ...n.data, awaitingContinue: false } } : n)))
                resolve()
            }

            const walk = async (nodeId: string) => {
                if (visited.has(nodeId)) return
                visited.add(nodeId)

                activeIds.add(nodeId)
                sync()

                const data = nodesRef.current.find((n) => n.id === nodeId)?.data as unknown as BuilderNodeData | undefined
                if (data?.subtype === 'humanInTheLoop') {
                    await waitForContinue(nodeId)
                } else {
                    await wait(RUN_STEP_MS)
                }

                activeIds.delete(nodeId)
                sync()

                const children = getDownstreamNodeIds(nodeId, edgesRef.current)
                await Promise.all(children.map(walk))
            }

            Promise.all(entryIds.map(walk)).then(() => {
                continueNodeRef.current = () => {}
            })
        },
        [setNodes],
    )

    const onConnect = useCallback(
        (connection: Connection) => setEdges((eds) => addEdge({ ...connection, type: 'deletable' }, eds)),
        [setEdges],
    )

    const onAddNode = useCallback(
        (node: Node) => {
            const data = node.data as unknown as BuilderNodeData
            const withCallbacks = {
                ...node,
                data: { ...data, onRun: () => runDryRun(node.id), onContinue: () => onContinueNode(node.id) },
            }
            setNodes((nds) => nds.concat(withCallbacks))
        },
        [setNodes, runDryRun, onContinueNode],
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
                    onRun:       () => runDryRun(id),
                    onContinue:  () => onContinueNode(id),
                }),
            )
            setNodes(newNodes)
            setEdges(newEdges)
            setProfileName(name)
            setConfigId(null)
            setConfigNodeId(null)
        },
        [onConfigureNode, onDeleteNode, runDryRun, onContinueNode, setNodes, setEdges],
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
