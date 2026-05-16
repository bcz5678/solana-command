import BN from 'bn.js';


export interface TokenMetaDTO {
    name: string,
    symbol: string,
    description?: string,
    logo_url?: string,
}


export interface BaseTokenDTO {
    id?: number;
    created_at?: string;
    name: string;
    symbol: string;
    contract_address: string | null;
}


export interface CreatedTokenDTO extends BaseTokenDTO {
    owner_id: number;
    dev_wallet_id: number;
    mint_secret_key: string | null;
    description: string;
    logo_url: string;
    token_meta_url: string | null;
    launched: boolean | null
    website_url: string | null
    twitter_url: string | null
    telegram_handle: string | null
}