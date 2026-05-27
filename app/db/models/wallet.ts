
// Wallet Data Transfer Object for API calls
import BN from 'bn.js';
import { BaseTokenDTO, CreatedTokenDTO } from './token';


export interface TokenHoldingsDTO {
    held_tokens: BaseTokenDTO[],
    created_tokens: CreatedTokenDTO[],
} 

export interface WalletModelDTO {
    id?: number;
    created_at?: string; 
    public_key: string;
    secret_key: string;

    wallet_label:     string | null
    chain:            string
    is_active:        boolean

    // Ownership
    owner_record_id:  string | null
    role:             'sole' | 'primary' | 'co-owner' | 'view-only' | null
    can_sign:         boolean | null
    can_view:         boolean | null
    can_share:        boolean | null
    granted_at:       string | null

    // Type — both ID and name returned for filter + display
    wallet_type_id:   string | null   // ← filter by this
    wallet_type:      string | null   // ← display this

    // Group — both ID and name returned for filter + display
    wallet_group_id:  string | null   // ← filter by this
    group_name:       string | null   // ← display this
    group_color:      string | null   // ← display this
    
    solana_balance_in_lamports: BN;
    token_holdings: TokenHoldingsDTO[];
}

export interface WalletTypeDTO {
    id?: number;
    created_at?: string;
    name: string;
}

export interface WalletGroupDTO {
    id?: number;
    created_at?: string;
    name: string;
    owner_id: number;
}

export interface OwnerDTO {
    id?: number;
    created_at?: string;
    name: string;
}

export interface WalletTradeDTO  {
    walletId: number
    tradeType: string
    buyAmountInSOL: BN
    tokensAmountHeld: BN | null
    percentOfSupplyHeld: BN | null
    marketCapAtBuy: BN | null
}



// Wallet entity f

export class Wallet {
    constructor(
        public id: number,
        public created_at: string, 
        public public_key: string,
        public private_key: string,
        public funded: boolean,
        public wallet_type: number,
        public solana_balance_in_lamports: BN,
        public owner: number,
        public group : number,
        public token_holdings: TokenHoldingsDTO[],
    ){}
}