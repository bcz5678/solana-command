import type { Node, Edge } from '@xyflow/react'
import { BuilderNodeCategory, BuilderNodeData, BuilderNodeType, BuilderSubtype } from './types'
import { PALETTE_ITEMS } from './node-palette-config'

type Callbacks = Pick<BuilderNodeData, 'onConfigure' | 'onDelete'>

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
/**
 * Reconstructs live xyflow nodes/edges from a saved LaunchProfile.
 * Callbacks (onConfigure, onDelete) are re-created via makeCallbacks since
 * they are stripped from the profile on save (functions aren't JSON-serialisable).
 */
export function applyLaunchProfile(
    profile: LaunchProfile,
    makeCallbacks: (id: string) => Callbacks,
): { nodes: Node[]; edges: Edge[] } {
    const nodes: Node[] = profile.nodes.map((pn) => {
        const paletteDef = PALETTE_ITEMS.find((i) => i.subtype === pn.subtype)
        return {
            id: pn.id,
            type: pn.type,
            position: pn.position,
            data: {
                category: pn.category,
                subtype: pn.subtype,
                label: pn.label,
                config: pn.config,
                inputTypes:  paletteDef?.inputTypes  ?? [],
                outputTypes: paletteDef?.outputTypes ?? [],
                ...makeCallbacks(pn.id),
            } as unknown as Record<string, unknown>,
        }
    })

    const edges: Edge[] = profile.edges.map((pe) => ({
        id: pe.id,
        source: pe.source,
        sourceHandle: pe.sourceHandle,
        target: pe.target,
        targetHandle: pe.targetHandle,
        type: 'deletable',
    }))

    return { nodes, edges }
}

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
