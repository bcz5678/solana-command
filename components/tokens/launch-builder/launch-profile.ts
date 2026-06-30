import type { Node, Edge } from '@xyflow/react'
import { BuilderNodeCategory, BuilderNodeData, BuilderNodeType, BuilderSubtype } from './types'

export const LAUNCH_PROFILE_SCHEMA_VERSION = 1

export type LaunchProfileNode = {
    id: string
    type: BuilderNodeType
    category: BuilderNodeCategory
    subtype: BuilderSubtype
    label: string
    position: { x: number; y: number }
    /** node-specific config populated via the configure modal — already JSON-safe (no functions) */
    config: Record<string, unknown>
}

export type LaunchProfileEdge = {
    id: string
    source: string
    sourceHandle: string | null
    target: string
    targetHandle: string | null
}

export type LaunchProfile = {
    schemaVersion: number
    name: string
    description: string | null
    nodes: LaunchProfileNode[]
    edges: LaunchProfileEdge[]
}

export type LaunchProfileMeta = {
    name?: string
    description?: string | null
}

/**
 * Derives a JSON-safe snapshot of the canvas from live xyflow state.
 * Pure and side-effect free — callers (UI, future save API) re-run this
 * whenever nodes/edges change rather than maintaining a parallel copy.
 */
export function buildLaunchProfile(
    nodes: Node[],
    edges: Edge[],
    meta: LaunchProfileMeta = {},
): LaunchProfile {
    return {
        schemaVersion: LAUNCH_PROFILE_SCHEMA_VERSION,
        name: meta.name?.trim() || 'Untitled Launch',
        description: meta.description ?? null,
        nodes: nodes.map((node): LaunchProfileNode => {
            const data = node.data as unknown as BuilderNodeData
            return {
                id: node.id,
                type: node.type as BuilderNodeType,
                category: data.category,
                subtype: data.subtype,
                label: data.label,
                position: { x: node.position.x, y: node.position.y },
                config: data.config,
            }
        }),
        edges: edges.map((edge): LaunchProfileEdge => ({
            id: edge.id,
            source: edge.source,
            sourceHandle: edge.sourceHandle ?? null,
            target: edge.target,
            targetHandle: edge.targetHandle ?? null,
        })),
    }
}
