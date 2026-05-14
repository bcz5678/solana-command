import { Icon } from "next/dist/lib/metadata/types/metadata-types"

export enum LaunchType {
    unselected = "Unselected",
    block0 = "Block0",
    swarm = "Swarm",
    staggered = "Staggered",
}

export interface LaunchTypeParams {
    title: string
    description: string
}
