import { Icon } from "next/dist/lib/metadata/types/metadata-types"

export enum LaunchType {
    unselected = "Unselected",
    basic = "Basic",
    block0 = "Block0",
    staggered = "Staggered",
}

export interface LaunchTypeParams {
    title: string
    description: string
}
