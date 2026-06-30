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

export type PaletteNodeDef = {
    category: BuilderNodeCategory
    nodeType: BuilderNodeType
    subtype: BuilderSubtype
    label: string
    description: string
    icon: LucideIcon
    inputs: 0 | 1
    /** number of output handles, or 'dynamic' for nodes whose output count is set via config (e.g. Switch) */
    outputs: number | 'dynamic'
    defaultData?: Record<string, unknown>
}

export type BuilderNodeData = {
    category: BuilderNodeCategory
    subtype: BuilderSubtype
    label: string
    /** node-specific config populated via the configure modal */
    config: Record<string, unknown>
    onConfigure?: () => void
    onDelete?: () => void
}
