// lib/types/token.ts
import BN from 'bn.js';

export interface TokenMint {
  id:                string
  user_id:           string
  mint_public_key:   string
  token_name:        string
  token_symbol:      string
  description:       string | null
  logo_url:          string | null
  decimals:          number
  token_type:        'fungible' | 'nft' | 'semi_fungible'
  chain:             string             // ← added
  launch_status:     'draft' | 'ready' | 'launching' | 'launched' | 'failed'  // ← added
  current_supply:    number
  max_supply:        number | null
  metadata_uri:      string | null
  is_active:         boolean
  authority_revoked: boolean
  freeze_revoked:    boolean
  dev_wallet_id:     string | null      // ← added
  vanity_keypair_id: string | null      // ← added
  created_at:        string
  updated_at:        string
}


export interface TokenMetaDTO {
    name: string
    symbol: string
    description?: string
    logo_url?: string
    website_url?: string
    twitter_url?: string
    telegram_handle?: string
}


export interface BaseTokenDTO {
    id?: number;
    created_at?: string;
    name: string;
    symbol: string;
    contract_address: string | null;
}

