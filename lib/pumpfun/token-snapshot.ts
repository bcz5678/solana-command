import { PublicKey, Connection } from "@solana/web3.js";

import { initializeQuickNodeSolana } from "@/app/api/utils/helpers";
import { isBondingCurveActive } from "@/lib/trade/bonding-curve";
import { buildGenericTokenPreview } from "@/lib/trade/token-preview";
import { resolveTradeableMint } from "@/lib/trade/resolve-mint";
import { tokenPreviewFromPumpApi, TokenPreview } from "@/lib/types/token-pumpfun";
import { fetchPumpCoinApi } from "./pump-api";

const quicknodeSolana = initializeQuickNodeSolana();

/**
 * Token preview lookup — routes to the pump.fun bonding-curve path while the mint
 * has a live curve, otherwise falls back to a generic (Jupiter-priced) preview.
 * Mirrors the Executor split in lib/pumpfun/executor.ts.
 */
export async function getTokenPreview(mint: PublicKey, connection: Connection = quicknodeSolana.connection): Promise<TokenPreview | null> {
  const resolvedMint = await resolveTradeableMint(connection, mint);

  if (await isBondingCurveActive(connection, resolvedMint)) {
    const api = await fetchPumpCoinApi(resolvedMint);
    if (!api) return null; // curve is live but pump.fun's API hiccuped — let the caller retry
    return tokenPreviewFromPumpApi(api);
  }

  return buildGenericTokenPreview(resolvedMint, connection);
}
