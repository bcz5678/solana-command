import { PublicKey } from '@solana/web3.js';
import BN from 'bn.js';
import { solNumberToLamportsBN } from '@/lib/lamports';

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
  // pump.fun's coins API also indexes tokens that never went through their launchpad
  // (e.g. USDC) so its UI can support trading them — `complete` is set true for those
  // too, which does NOT mean "graduated." indexed_by_pump distinguishes the two.
  indexed_by_pump?:            boolean;
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

// Bonding-curve-specific state — present on a TokenPreview only while the mint
// has a live, non-graduated pump.fun curve (see lib/trade/bonding-curve.ts).
export interface TokenCurveInfo {
  bondingCurve:            PublicKey;
  associatedBondingCurve:  PublicKey;
  virtualSolReserves:      BN;   // lamports
  virtualTokenReserves:    BN;   // raw token units
  realSolReserves:         BN;   // lamports
  realTokenReserves:       BN;   // raw token units
  totalSupply:             BN;   // raw token units
}

// Normalized token preview — covers both pump.fun bonding-curve mints and generic
// SPL mints (graduated pump.fun coins or anything that never touched pump.fun).
// `curve` is the only part that's pump.fun-specific; everything else renders the
// same regardless of where the data came from.
export interface TokenPreview {
  readonly mint:               PublicKey;
  readonly name:               string;
  readonly symbol:             string;
  readonly imageUri:           string | null;
  readonly decimals:           number;
  readonly complete:           boolean;            // true only for a graduated ex-pump.fun coin
  readonly pricePerTokenSol:   number | null;
  readonly marketCapSol:       BN | null;           // lamports
  readonly priceImpactPct:     number | null;       // static probe — see lib/trade/token-preview.ts
  readonly curve:              TokenCurveInfo | null;
}

export function tokenPreviewFromPumpApi(api: TokenApiSnapshot): TokenPreview {
  // complete:true also gets set for non-launchpad tokens pump.fun indexes for
  // trading (e.g. USDC) — indexed_by_pump distinguishes that from a real graduation.
  const complete = (api.indexed_by_pump ?? false) && api.complete;

  return {
    mint:             new PublicKey(api.mint),
    name:             api.name,
    symbol:           api.symbol,
    imageUri:         api.image_uri,
    decimals:         api.base_decimals ?? 6,
    complete,
    // pump.fun returns market_cap in SOL — convert to lamports. It has been observed to
    // return corrupted values (e.g. ~1e23) for some older coins, which overflows BN's
    // number constructor — solNumberToLamportsBN clamps to 0 rather than throwing.
    pricePerTokenSol: api.virtual_token_reserves > 0
      ? api.virtual_sol_reserves / api.virtual_token_reserves
      : null,
    marketCapSol:     solNumberToLamportsBN(api.market_cap),
    priceImpactPct:   null,
    curve: complete ? null : {
      bondingCurve:           new PublicKey(api.bonding_curve),
      associatedBondingCurve: new PublicKey(api.associated_bonding_curve),
      virtualSolReserves:     new BN(api.virtual_sol_reserves),
      virtualTokenReserves:   new BN(api.virtual_token_reserves),
      realSolReserves:        new BN(api.real_sol_reserves),
      realTokenReserves:      new BN(api.real_token_reserves),
      totalSupply:            new BN(api.total_supply),
    },
  };
}
