
// Wallet Data Transfer Object for API calls
import BN from 'bn.js';


export interface WalletModelDTO {
    id?: number;
    created_at?: string; 
    public_key: string;
    private_key: string;
    funded: boolean;
    wallet_type_id: number;
    solana_balance_in_lamports: BN;
    owner_id: number;
    group_id: number;
    token_holdings: TokenDTO[];
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

export interface TokenDTO {
    id?: number;
    created_at?: string;
    name: string;
    owner_id: number;
    symbol: string;
    description: string;
    dev_wallet_id: number;
    token_pair: string;
    token_amount_held: BN;
    contract_address: string | null;
    mint_keypair: string | null;
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
        public token_holdings: TokenDTO[],
    ){}
}