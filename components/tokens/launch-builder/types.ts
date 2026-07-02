import { LucideIcon } from 'lucide-react'

export type BuilderNodeCategory = 'token' | 'launchType' | 'trade' | 'trigger' | 'conditional'

export type BuilderNodeType =
    | 'tokenNode'
    | 'launchTypeNode'
    | 'tradeNode'
    | 'triggerNode'
    | 'conditionalNode'

export type TokenSubtype = 'tokenToLaunch'
export type LaunchTypeSubtype = 'dev0DevOnly' | 'dev0DevBundle' | 'bundled' | 'swarm'
export type TradeSubtype = 'bundledJito' | 'staggeredBuy' | 'humanVolume' | 'trendingVolume' | 'holdersMaker'
export type TriggerSubtype = 'launchConfirmation' | 'txConfirmation' | 'timerSet' | 'timerRandomInterval' | 'humanInTheLoop'
export type ConditionalSubtype = 'loop' | 'ifThen' | 'switch'

export type BuilderSubtype = TokenSubtype | LaunchTypeSubtype | TradeSubtype | TriggerSubtype | ConditionalSubtype

/**
 * The data type carried by a handle wire.
 *
 *   token  → raw token identity (mint, name, dev wallet)
 *   config → full execution context flowing through trade nodes
 *   signal → control-flow gate from a trigger
 *   branch → one output arm from a conditional node
 */
export type HandleDataType = 'token' | 'config' | 'signal' | 'branch'

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
    /** node-specific config populated via the configure modal */
    config: Record<string, unknown>
    /** typed I/O declarations — set on drop, restored on load */
    inputTypes?: HandleDataType[]
    outputTypes?: HandleDataType[]
    onConfigure?: () => void
    onDelete?: () => void
}
