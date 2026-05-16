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

export interface TokenDTO {
    id: number
    created_at: string
    name: string
    symbol: string
    description: string
    dev_wallet_id: number
    contract_address: string | null
    mint_keypair: string | null
    logo_image_path: string | null
    logo_url: string | null
    launched: boolean | null
    website_url: string | null
    twitter_url: string | null
    telegram_handle: string | null
}
