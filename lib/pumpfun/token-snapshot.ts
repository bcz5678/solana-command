import { PublicKey } from "@solana/web3.js";
import { OnlinePumpSdk, bondingCurveMarketCap } from "@nirholas/pump-sdk";
import BN from "bn.js";

import { initializeQuickNodeSolana } from "@/app/api/utils/helpers";
import { TokenApiSnapshot, TokenSnapshot } from "@/lib/types/token-pumpfun";

const quicknodeSolana = initializeQuickNodeSolana();
const onlineSdk = new OnlinePumpSdk(quicknodeSolana.connection);

export async function getTokenSnapshot(mint: PublicKey): Promise<TokenSnapshot | null> {
  try {
    const res = await fetch(`https://frontend-api-v3.pump.fun/coins/${mint.toBase58()}`);
    if (!res.ok) return null;
    const api = await res.json() as TokenApiSnapshot;
    return new TokenSnapshot(api);
  } catch {
    return null;
  }
}

// Fetches latest bonding-curve state and mutates the snapshot in place.
export async function updateTokenSnapshot(snapshot: TokenSnapshot): Promise<void> {
  const bc = await onlineSdk.fetchBondingCurve(snapshot.mint);

  if (bc.complete || bc.virtualTokenReserves.isZero()) {
    snapshot.applyUpdate({
      mint:             snapshot.mint,
      marketCapLamports: new BN(0),
      pricePerToken:    0,
      realSolReserves:  bc.realSolReserves,
      realTokenReserves: bc.realTokenReserves,
      complete:         true,
    });
    return;
  }

  const marketCapLamports = bondingCurveMarketCap({
    mintSupply:           bc.tokenTotalSupply,
    virtualSolReserves:   bc.virtualSolReserves,
    virtualTokenReserves: bc.virtualTokenReserves,
  });

  snapshot.applyUpdate({
    mint:             snapshot.mint,
    marketCapLamports,
    pricePerToken:    bc.virtualSolReserves.toNumber() / bc.virtualTokenReserves.toNumber(),
    realSolReserves:  bc.realSolReserves,
    realTokenReserves: bc.realTokenReserves,
    complete:         false,
  });
}
