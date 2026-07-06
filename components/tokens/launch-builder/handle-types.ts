import type { Node, Edge } from '@xyflow/react'
import type { HandleDataType, BuilderNodeData, BuilderSubtype } from './types'

// ── Visual metadata per handle type ─────────────────────────────────────────

export const HANDLE_TYPE_META: Record<HandleDataType, {
    label: string
    border: string   // Tailwind border-* class
    bg: string       // Tailwind bg-* class (solid, for the filled dot state)
    text: string     // Tailwind text-* class
    stroke: string   // Tailwind stroke-* class, for the SVG output-triangle glyph
}> = {
    exec:   { label: 'Exec',   border: 'border-lime-400',    bg: 'bg-lime-400',    text: 'text-lime-400',    stroke: 'stroke-lime-400' },
    token:  { label: 'Token',  border: 'border-amber-400',   bg: 'bg-amber-400',   text: 'text-amber-400',   stroke: 'stroke-amber-400' },
    config: { label: 'Config', border: 'border-violet-500',  bg: 'bg-violet-500',  text: 'text-violet-500',  stroke: 'stroke-violet-500' },
    signal: { label: 'Signal', border: 'border-emerald-400', bg: 'bg-emerald-400', text: 'text-emerald-400', stroke: 'stroke-emerald-400' },
    branch: { label: 'Branch', border: 'border-rose-400',    bg: 'bg-rose-400',    text: 'text-rose-400',    stroke: 'stroke-rose-400' },
    data:   { label: 'Data',   border: 'border-cyan-400',    bg: 'bg-cyan-400',    text: 'text-cyan-400',    stroke: 'stroke-cyan-400' },
}

// ── Compatibility ─────────────────────────────────────────��──────────────────

/**
 * Maps each output type to the input types it may connect to.
 *
 *   exec   → exec    (Execution node → the universal "exec-in" pin every node exposes)
 *   token  → token   (Token → LaunchType only)
 *   config → config  (LaunchType → Trade, Trade → Trade)
 *   signal → signal  (Trigger → Conditional)
 *   branch → config  (branch re-enters a trade chain)
 *          | signal  (branch can also feed another trigger/conditional)
 */
const TYPE_COMPATIBLE: Record<HandleDataType, HandleDataType[]> = {
    exec:   ['exec'],
    token:  ['token'],
    config: ['config'],
    // signal carries the execution context forward through a timing gate,
    // so it can feed anything that accepts a plain config as well
    signal: ['signal', 'config'],
    branch: ['config', 'signal'],
    data:   ['data'],
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
/**
 * Direct nodes wired to an Execution node's "exec-in" pin — the dry-run
 * entry points. Each one becomes an independent branch walker so a Human In
 * The Loop pause on one branch doesn't stall sibling branches.
 */
export function getExecEntryNodeIds(execNodeId: string, edges: Edge[]): string[] {
    return Array.from(new Set(
        edges
            .filter((e) => e.source === execNodeId && e.targetHandle === 'exec-in')
            .map((e) => e.target),
    ))
}

/** Nodes directly downstream of a node, following normal (non-exec) edges. */
export function getDownstreamNodeIds(nodeId: string, edges: Edge[]): string[] {
    return edges
        .filter((e) => e.source === nodeId && e.targetHandle !== 'exec-in')
        .map((e) => e.target)
}

/** Nodes downstream of one specific output handle (e.g. Loop's 'output-0' Body arm). */
export function getDownstreamNodeIdsByHandle(nodeId: string, edges: Edge[], sourceHandle: string): string[] {
    return edges
        .filter((e) => e.source === nodeId && e.targetHandle !== 'exec-in' && e.sourceHandle === sourceHandle)
        .map((e) => e.target)
}

/**
 * Builds the flat JSON payload a Data node resolves to — purely from its own
 * custom fields, nothing implicit. A field value of `{{name}}`/`{{name.path}}`
 * is left as-is here; the dry-run engine resolves those against the named
 * variable store right before sending (see `callWebhook` in launch-builder.tsx).
 * Reference a Token node's fields the same way any other node's output is
 * referenced now: name it and use `{{thatName.tokenMint}}` etc.
 */
export function buildDataNodePayload(dataNodeConfig: Record<string, unknown>): Record<string, unknown> {
    const payload: Record<string, unknown> = {}

    const customFields = (dataNodeConfig.customFields as { key: string; value: string }[] | undefined) ?? []
    customFields.forEach(({ key, value }) => {
        const trimmed = key.trim()
        if (trimmed) payload[trimmed] = value
    })

    return payload
}

/** Every node id reachable by walking backward (target → source) from `startNodeId`, any number of hops. */
function collectUpstreamNodeIds(startNodeId: string, edges: Edge[]): Set<string> {
    const visited = new Set<string>()
    const queue = [startNodeId]
    while (queue.length > 0) {
        const current = queue.shift() as string
        for (const e of edges) {
            if (e.target !== current || visited.has(e.source)) continue
            visited.add(e.source)
            queue.push(e.source)
        }
    }
    return visited
}

export type OutputFieldDef = { key: string; label: string }

/**
 * Declares exactly which fields a node type exposes as its variable on
 * completion — the single contract both the dry-run engine (the object
 * passed to setVariable in launch-builder.tsx's call* functions) and the
 * variable picker (the {{name.field}} options it lists) read from, so they
 * can't drift from each other the way an ad hoc per-call-site field list
 * could. Subtypes not listed here have no curated output — their variable
 * falls back to the raw baseline (that node's own config), which is
 * genuinely all there is for un-implemented launch/trade types and pure
 * control-flow nodes (timers, HITL, webhook, thresholds not yet backed, etc).
 */
export const NODE_OUTPUT_FIELDS: Partial<Record<BuilderSubtype, OutputFieldDef[]>> = {
    tokenToLaunch: [
        { key: 'tokenMint',          label: 'Token Mint' },
        { key: 'tokenName',          label: 'Token Name' },
        { key: 'tokenSymbol',        label: 'Token Symbol' },
        { key: 'devWalletPublicKey', label: 'Dev Wallet Id' },
    ],
    dev0DevOnly: [
        { key: 'signature',          label: 'Launch Signature' },
        { key: 'tokenMint',          label: 'Token Mint' },
        { key: 'devWalletPublicKey', label: 'Dev Wallet Id' },
    ],
    launchConfirmation: [
        { key: 'signature', label: 'Confirmed Signature' },
        { key: 'tokenMint', label: 'Token Mint' },
    ],
    txConfirmation: [
        { key: 'signature', label: 'Confirmed Signature' },
    ],
    staggeredBuy:  [{ key: 'signature', label: 'Last Signature' }, { key: 'walletIds', label: 'Wallet IDs' }],
    staggeredSell: [{ key: 'signature', label: 'Last Signature' }, { key: 'walletIds', label: 'Wallet IDs' }],
    sellPercent:   [{ key: 'signature', label: 'Last Signature' }, { key: 'walletIds', label: 'Wallet IDs' }],
    sellAll:       [{ key: 'bundleId', label: 'Jito Bundle ID' }, { key: 'walletIds', label: 'Wallet IDs' }],
    bundledJito:   [{ key: 'bundleId', label: 'Jito Bundle ID' }, { key: 'walletIds', label: 'Wallet IDs' }],
    humanVolume:   [{ key: 'walletIds', label: 'Wallet IDs' }, { key: 'wallets', label: 'Wallets' }],
}

/**
 * Every named node referenceable as `{{name}}` from a given node — scoped
 * to nodes actually upstream of it in the graph (walking backward through
 * edges, same reachability `findTokenNodeData` relies on), not every named
 * node anywhere on the canvas. A node in an unrelated branch may run before
 * or after this one depending on timing, so its variable isn't reliably
 * available here even though it's global in the `variables` store at Run
 * time — upstream is the deterministic subset. Names only, never values:
 * actual values only exist inside a live Run, not while editing the graph.
 *
 * `fields` is looked up from NODE_OUTPUT_FIELDS above — empty for any
 * subtype without a declared output, meaning only the bare {{name}} (the
 * raw config baseline) is meaningfully referenceable.
 */
export function collectAvailableVariables(nodeId: string, nodes: Node[], edges: Edge[]): { name: string; fields: OutputFieldDef[] }[] {
    const upstreamIds = collectUpstreamNodeIds(nodeId, edges)
    const byName = new Map<string, OutputFieldDef[]>()
    for (const n of nodes) {
        if (!upstreamIds.has(n.id)) continue
        const data = n.data as unknown as BuilderNodeData
        if (data.subtype === 'setVariable') {
            const name = (data.config?.variableName as string | undefined)?.trim()
            if (name) byName.set(name, [])
        }
        const name = data.displayName?.trim()
        if (name) byName.set(name, NODE_OUTPUT_FIELDS[data.subtype] ?? [])
    }
    return Array.from(byName.entries())
        .map(([name, fields]) => ({ name, fields }))
        .sort((a, b) => a.name.localeCompare(b.name))
}

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
