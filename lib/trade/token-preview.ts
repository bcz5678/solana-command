import { Connection, PublicKey } from '@solana/web3.js';
import { getMint } from '@solana/spl-token';
import BN from 'bn.js';

import { getJupiterQuote, searchJupiterToken, WRAPPED_SOL_MINT } from './jupiter';
import { resolveTokenProgram } from './wallet-balance';
import { fetchPumpCoinApi } from '@/lib/pumpfun/pump-api';
import { solNumberToLamportsBN } from '@/lib/lamports';
import { TokenPreview } from '@/lib/types/token-pumpfun';

// 1 SOL — a fixed probe size used only to derive a display price / liquidity
// estimate, not tied to any real trade amount.
const PROBE_SOL_LAMPORTS = 1_000_000_000;

/**
 * Generic SPL token preview — for graduated pump.fun mints and any mint that
 * never touched pump.fun at all. Mirrors GenericSwapExecutor: no bonding curve,
 * priced via a Jupiter quote instead of bonding-curve reserves.
 *
 * Metadata falls back through pump.fun (rich, covers ex-pump.fun coins) → Jupiter's
 * token search (covers most other liquid tokens) → a bare on-chain mint read with a
 * placeholder name, in that order.
 */
export async function buildGenericTokenPreview(mint: PublicKey, connection: Connection): Promise<TokenPreview> {
  const mintStr = mint.toBase58();

  const [pumpApi, jupiterInfo, quote] = await Promise.all([
    fetchPumpCoinApi(mint),
    searchJupiterToken(mintStr),
    getJupiterQuote(WRAPPED_SOL_MINT, mintStr, new BN(PROBE_SOL_LAMPORTS), 100).catch(() => null),
  ]);

  let decimals = pumpApi?.base_decimals ?? jupiterInfo?.decimals ?? null;
  if (decimals == null) {
    // Neither pump.fun nor Jupiter know this mint — fall back to a bare on-chain read.
    const tokenProgram = await resolveTokenProgram(connection, mint);
    const mintAccount = await getMint(connection, mint, undefined, tokenProgram);
    decimals = mintAccount.decimals;
  }

  const outAmount = quote ? new BN(quote.outAmount) : null;
  const outAmountUi = outAmount && !outAmount.isZero()
    ? Number(outAmount.toString()) / 10 ** decimals // display-only — never used for trade math
    : null;
  const pricePerTokenSol = outAmountUi != null
    ? (PROBE_SOL_LAMPORTS / 1e9) / outAmountUi
    : null;

  const totalSupplyUi = jupiterInfo?.totalSupply ?? null;
  const marketCapSol = pricePerTokenSol != null && totalSupplyUi != null
    ? solNumberToLamportsBN(pricePerTokenSol * totalSupplyUi)
    : null;

  const priceImpactPct = typeof quote?.priceImpactPct === 'string'
    ? parseFloat(quote.priceImpactPct)
    : null;

  return {
    mint,
    name:             pumpApi?.name || jupiterInfo?.name || 'Unknown Token',
    symbol:           pumpApi?.symbol || jupiterInfo?.symbol || mintStr.slice(0, 4).toUpperCase(),
    imageUri:         pumpApi?.image_uri || jupiterInfo?.icon || null,
    decimals,
    // pump.fun marks complete:true both for genuine graduated launches AND for
    // non-launchpad tokens it indexes for trading (e.g. USDC) — indexed_by_pump
    // distinguishes "actually graduated off a curve" from "never had one."
    complete:         (pumpApi?.indexed_by_pump ?? false) && (pumpApi?.complete ?? false),
    pricePerTokenSol,
    marketCapSol,
    priceImpactPct,
    curve:            null,
  };
}
