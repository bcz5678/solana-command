import { PublicKey } from '@solana/web3.js';
import BN from 'bn.js';

function solToLamportsBN(sol: number): BN {
  const lamports = Math.round(sol * 1e9);
  return Number.isSafeInteger(lamports) ? new BN(lamports) : new BN(0);
}

// Raw shape returned by the pump.fun REST API
export interface TokenApiSnapshot {
  mint:                       string;
  initialized:                boolean;
  name:                       string;
  symbol:                     string;
  description:                string;
  image_uri:                  string;
  metadata_uri:               string;
  twitter:                    string | null;
  bonding_curve:              string;
  associated_bonding_curve:   string;
  creator:                    string;
  created_timestamp:          number;
  complete:                   boolean;
  virtual_sol_reserves:       number;   // lamports
  virtual_token_reserves:     number;   // raw token units
  total_supply:               number;   // raw token units
  total_supply_str:           string;
  website:                    string | null;
  show_name:                  boolean;
  last_trade_timestamp:       number;
  market_cap:                 number;   // SOL
  market_cap_quote:           number;
  usd_market_cap:             number;
  nsfw:                       boolean;
  is_banned:                  boolean;
  real_sol_reserves:          number;   // lamports
  real_token_reserves:        number;   // raw token units
  virtual_quote_reserves:     number;
  real_quote_reserves:        number;
  updated_at:                 number;
  livestream_ban_expiry:      number;
  reply_count:                number;
  is_currently_live:          boolean;
  ath_market_cap:             number;   // SOL
  ath_market_cap_timestamp:   number;
  hide_banner:                boolean;
  program:                    string;
  token_program:              string;
  quote_mint:                 string;
  base_decimals:              number;
  quote_decimals:             number;
  pool_address:               string;
  is_cashback_enabled:        boolean;
  chain_id:                   string;
  multichain_family:          number;
  protocol:                   string;
}

// Shape returned by the pump SDK's bonding-curve fetcher for subsequent updates
export interface TokenUpdate {
  mint:               PublicKey;
  marketCapLamports:  BN;
  pricePerToken:      number;
  realSolReserves:    BN;
  realTokenReserves:  BN;
  complete:           boolean;
}

// Normalized token state. Constructed from a TokenApiSnapshot (initial REST pull),
// then kept fresh via applyUpdate() from SDK bonding-curve reads.
export class TokenSnapshot {
  // Identity
  readonly mint:                    PublicKey;
  readonly name:                    string;
  readonly symbol:                  string;
  readonly description:             string;
  readonly imageUri:                string;
  readonly metadataUri:             string;
  readonly twitter:                 string | null;
  readonly website:                 string | null;

  // Curve addresses
  readonly bondingCurve:            PublicKey;
  readonly associatedBondingCurve:  PublicKey;
  readonly creator:                 PublicKey;

  // Mutable state
  complete:       boolean;
  pricePerToken:  number;
  usdMarketCap:   number;

  // Reserves — BN, lamports / raw token units
  readonly virtualSolReserves:    BN;
  readonly virtualTokenReserves:  BN;
  readonly totalSupply:           BN;
  realSolReserves:                BN;
  realTokenReserves:              BN;

  // Market cap — BN, lamports
  readonly initialMarketCap:  BN;
  marketCap:                  BN;
  readonly athMarketCap:      BN;

  // Timestamps
  readonly createdAt:   number;
  lastTradeAt:          number;
  updatedAt:            number;

  constructor(api: TokenApiSnapshot) {
    this.mint                   = new PublicKey(api.mint);
    this.name                   = api.name;
    this.symbol                 = api.symbol;
    this.description            = api.description;
    this.imageUri               = api.image_uri;
    this.metadataUri            = api.metadata_uri;
    this.twitter                = api.twitter;
    this.website                = api.website;

    this.bondingCurve           = new PublicKey(api.bonding_curve);
    this.associatedBondingCurve = new PublicKey(api.associated_bonding_curve);
    this.creator                = new PublicKey(api.creator);

    this.complete               = api.complete;

    // Reserves arrive from the API already in lamports / raw token units
    this.virtualSolReserves     = new BN(api.virtual_sol_reserves);
    this.virtualTokenReserves   = new BN(api.virtual_token_reserves);
    this.totalSupply            = new BN(api.total_supply);
    this.realSolReserves        = new BN(api.real_sol_reserves);
    this.realTokenReserves      = new BN(api.real_token_reserves);

    // API returns market_cap in SOL — convert to lamports. pump.fun has been observed to
    // return corrupted ath_market_cap values (e.g. ~1e23) for some older coins, which
    // overflows BN's number constructor — clamp to 0 rather than fail the whole snapshot.
    this.initialMarketCap       = solToLamportsBN(api.market_cap);
    this.marketCap              = this.initialMarketCap;
    this.usdMarketCap           = api.usd_market_cap;
    this.athMarketCap           = solToLamportsBN(api.ath_market_cap);

    this.pricePerToken          = api.virtual_sol_reserves / api.virtual_token_reserves;

    this.createdAt              = api.created_timestamp;
    this.lastTradeAt            = api.last_trade_timestamp;
    this.updatedAt              = api.updated_at;
  }

  applyUpdate(update: TokenUpdate): void {
    this.marketCap        = update.marketCapLamports;
    this.realSolReserves  = update.realSolReserves;
    this.realTokenReserves= update.realTokenReserves;
    this.pricePerToken    = update.pricePerToken;
    this.complete         = update.complete;
    this.updatedAt        = Date.now();
  }
}
