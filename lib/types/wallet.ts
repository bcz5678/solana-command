
// Wallet Data Transfer Object for API calls
import BN from 'bn.js';

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
    token_holdings: TokenHolding[];
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


// lib/types/wallet.ts

export interface TokenHolding {
  mint_address:  string        // token contract address
  token_name:    string | null // from your token_mints table if known
  token_symbol:  string | null
  logo_url:      string | null
  amount:        number        // raw amount in token base units
  decimals:      number        // for display: amount / 10^decimals
  ui_amount:     number        // pre-calculated: amount / 10^decimals
  is_native:     boolean       // true = wrapped SOL
}

export interface WalletRecord {
  // ── Core ──────────────────────────────────────────────────
  id:               string
  user_id:          string
  public_key:       string
  label:            string | null
  chain:            string
  is_active:        boolean
  created_at:       string

  // ── Ownership ─────────────────────────────────────────────
  owner_record_id:  string | null
  role:             'sole' | 'primary' | 'co-owner' | 'view-only' | null
  can_sign:         boolean | null
  can_view:         boolean | null
  can_share:        boolean | null
  granted_at:       string | null

  // ── Type ──────────────────────────────────────────────────
  wallet_type_id:   string | null
  wallet_type:      string | null

  // ── Group ─────────────────────────────────────────────────
  wallet_group_id:  string | null
  group_name:       string | null
  group_color:      string | null

  // ── On-chain balances (populated from RPC, not DB) ────────
  // These are NOT stored in the DB — fetched live from Solana RPC
  // null = not yet fetched
  solana_balance_in_lamports: BN | null    // raw lamports as BN (1 SOL = 1_000_000_000); use lamportsBNToSolDisplay() for display
  token_holdings:             TokenHolding[]  // SPL token accounts
  balances_fetched_at:        string | null   // ISO timestamp of last fetch
}