import type { Node, Edge } from '@xyflow/react'
import type { HandleDataType, BuilderNodeData } from './types'

// ── Visual metadata per handle type ─────────────────────────────────────────

export const HANDLE_TYPE_META: Record<HandleDataType, {
    label: string
    border: string   // Tailwind border-* class
    bg: string       // Tailwind bg-* class (solid, for the filled dot state)
    text: string     // Tailwind text-* class
}> = {
    token:  { label: 'Token',  border: 'border-amber-400',   bg: 'bg-amber-400',   text: 'text-amber-400' },
    config: { label: 'Config', border: 'border-violet-500',  bg: 'bg-violet-500',  text: 'text-violet-500' },
    signal: { label: 'Signal', border: 'border-emerald-400', bg: 'bg-emerald-400', text: 'text-emerald-400' },
    branch: { label: 'Branch', border: 'border-rose-400',    bg: 'bg-rose-400',    text: 'text-rose-400' },
}

// ── Compatibility ─────────────────────────────────────────��──────────────────

/**
 * Maps each output type to the input types it may connect to.
 *
 *   token  → token   (Token → LaunchType only)
 *   config → config  (LaunchType → Trade, Trade → Trade)
 *   signal → signal  (Trigger → Conditional)
 *   branch → config  (branch re-enters a trade chain)
 *          | signal  (branch can also feed another trigger/conditional)
 */
const TYPE_COMPATIBLE: Record<HandleDataType, HandleDataType[]> = {
    token:  ['token'],
    config: ['config'],
    signal: ['signal'],
    branch: ['config', 'signal'],
}

export function isCompatibleConnection(
    sourceOutputType: HandleDataType,
    targetInputType: HandleDataType,
): boolean {
    return TYPE_COMPATIBLE[sourceOutputType]?.includes(targetInputType) ?? false
}

// ── Runtime output-type resolution ──────────────────────────────────────────

/**
 * Returns the actual output types array for a node at runtime.
 * Switch nodes have a dynamic output count driven by config.branchCount,
 * so we expand the stored ['branch'] template into the correct-length array.
 */
export function getNodeOutputTypes(data: BuilderNodeData): HandleDataType[] {
    if (data.subtype === 'switch') {
        const count = (data.config?.branchCount as number) ?? 2
        return Array.from({ length: count }, () => 'branch' as HandleDataType)
    }
    return data.outputTypes ?? []
}

// ── Graph traversal ──────────────────────────────────────────────────────────

/**
 * Walks up the edge chain from a given node until it finds the Token node
 * (category === 'token').  Returns its BuilderNodeData, or null if not
 * reachable.  Used by node config dialogs to inherit token data without
 * scanning the entire canvas.
 */
export function findTokenNodeData(
    startNodeId: string,
    nodes: Node[],
    edges: Edge[],
): BuilderNodeData | null {
    const visited = new Set<string>()
    let currentId: string = startNodeId

    while (!visited.has(currentId)) {
        visited.add(currentId)
        const inEdge = edges.find((e) => e.target === currentId)
        if (!inEdge) break
        const sourceNode = nodes.find((n) => n.id === inEdge.source)
        if (!sourceNode) break
        const sourceData = sourceNode.data as unknown as BuilderNodeData
        if (sourceData.category === 'token') return sourceData
        currentId = inEdge.source
    }
    return null
}
