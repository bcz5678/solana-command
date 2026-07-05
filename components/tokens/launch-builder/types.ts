import { LucideIcon } from 'lucide-react'

export type BuilderNodeCategory = 'execution' | 'token' | 'launchType' | 'trade' | 'trigger' | 'conditional' | 'utility'

export type BuilderNodeType =
    | 'executionNode'
    | 'tokenNode'
    | 'launchTypeNode'
    | 'tradeNode'
    | 'triggerNode'
    | 'conditionalNode'
    | 'dataNode'
    | 'webhookNode'
    | 'noOpNode'

export type ExecutionSubtype = 'manualRun'
export type TokenSubtype = 'tokenToLaunch'
export type LaunchTypeSubtype = 'dev0DevOnly' | 'dev0DevBundle' | 'bundled' | 'swarm'
export type TradeSubtype = 'bundledJito' | 'staggeredBuy' | 'staggeredSell' | 'sellPercent' | 'sellAll' | 'humanVolume' | 'trendingVolume' | 'holdersMaker'
export type TriggerSubtype =
    | 'launchConfirmation'
    | 'txConfirmation'
    | 'timerSet'
    | 'timerRandomInterval'
    | 'humanInTheLoop'
    | 'marketCapThreshold'
    | 'holderCountThreshold'
    | 'volumeThreshold'
    | 'priceTarget'
    | 'retryBackoff'
    | 'branchReset'
export type ConditionalSubtype = 'loop' | 'ifThen' | 'switch'
export type UtilitySubtype = 'dataMapper' | 'webhook' | 'noOp'

export type BuilderSubtype = ExecutionSubtype | TokenSubtype | LaunchTypeSubtype | TradeSubtype | TriggerSubtype | ConditionalSubtype | UtilitySubtype

/**
 * The data type carried by a handle wire.
 *
 *   exec   → manual "start here" control signal from an Execution node
 *   token  → raw token identity (mint, name, dev wallet)
 *   config → full execution context flowing through trade nodes
 *   signal → control-flow gate from a trigger
 *   branch → one output arm from a conditional node
 *   data   → structured key-value payload from a Data node
 */
export type HandleDataType = 'exec' | 'token' | 'config' | 'signal' | 'branch' | 'data'

export type PaletteNodeDef = {
    category: BuilderNodeCategory
    nodeType: BuilderNodeType
    subtype: BuilderSubtype
    label: string
    description: string
    icon: LucideIcon
    inputs: 0 | 1
    /** number of output handles, or 'dynamic' for Switch whose count comes from config */
    outputs: number | 'dynamic'
    inputTypes: HandleDataType[]
    /** For Switch use ['branch'] — actual count is derived at runtime from config.branchCount */
    outputTypes: HandleDataType[]
    defaultData?: Record<string, unknown>
}

export type BuilderNodeData = {
    category: BuilderNodeCategory
    subtype: BuilderSubtype
    label: string
    /** user-set custom name for this node instance, for referencing steps in the workflow. Falls back to `label` when unset. */
    displayName?: string
    /** node-specific config populated via the configure modal */
    config: Record<string, unknown>
    /** typed I/O declarations — set on drop, restored on load */
    inputTypes?: HandleDataType[]
    outputTypes?: HandleDataType[]
    onConfigure?: () => void
    onDelete?: () => void
    /** Renames this node instance (empty string clears back to the default type label). */
    onRename?: (name: string) => void
    /** Manual Execution node only — triggers a visual dry-run walk downstream from this node. */
    onRun?: () => void
    /** Human In The Loop trigger only — set true by the dry-run engine while it's paused waiting on this node. */
    awaitingContinue?: boolean
    /** Human In The Loop trigger only — resumes a paused dry-run past this node. */
    onContinue?: () => void
    /** Timer triggers only — whole seconds remaining, set by the dry-run engine while counting down. */
    runCountdown?: number
    /**
     * Webhook/LaunchType/Trade/Confirmation-trigger nodes — result of the last
     * dry-run/live call, for the response badge. `signature` carries the raw
     * tx signature (or Jito bundle id) so a downstream confirmation trigger
     * can read it off its immediate predecessor.
     */
    executionResult?: { ok: boolean; status?: number; message: string; signature?: string }
}
