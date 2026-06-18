// lib/types/token.ts
import BN from 'bn.js';

// lib/types/token.ts
export interface TokenMint {
  id:                string
  user_id:           string
  mint_public_key:   string
  token_name:        string
  token_symbol:      string
  description:       string | null
  logo_url:          string | null
  banner_url:        string | null

  // Primary links
  website_url:       string | null   // ← now wired
  twitter_url:       string | null   // ← now wired
  telegram_handle:   string | null   // ← now wired

  // Social links
  tiktok_url:        string | null
  instagram_url:     string | null
  discord_url:       string | null
  communities_url:   string | null

  decimals:          number
  token_type:        'fungible' | 'nft' | 'semi_fungible'
  chain:             string
  launch_status:     'draft' | 'ready' | 'launching' | 'launched' | 'failed'
  current_supply:    number
  max_supply:        number | null
  metadata_uri:      string | null
  is_active:         boolean
  authority_revoked: boolean
  freeze_revoked:    boolean
  dev_wallet_id:     string | null
  vanity_keypair_id: string | null
  created_at:        string
  updated_at:        string
}


export interface TokenMetaDTO {
    name:               string
    symbol:             string
    showName:           boolean
    description:        string | null
    image:              string | null
    banner:             string | null
  

    // Primary links
    website:            string | null
    twitter:            string | null
    telegram:           string | null

    // Social links
    tiktok:             string | null
    instagram:          string | null
    discord:            string | null
    coin_community:     string | null
}


export interface BaseTokenDTO {
    id?: number;
    created_at?: string;
    name: string;
    symbol: string;
    contract_address: string | null;
}


