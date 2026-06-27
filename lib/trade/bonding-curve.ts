import { Connection, PublicKey } from '@solana/web3.js';
import { OnlinePumpSdk } from '@nirholas/pump-sdk';

/** True if `mint` has a live (non-graduated) pump.fun bonding curve. */
export async function isBondingCurveActive(connection: Connection, mint: PublicKey): Promise<boolean> {
  try {
    const onlineSdk = new OnlinePumpSdk(connection);
    const bc = await onlineSdk.fetchBondingCurve(mint);
    return !bc.complete && !bc.virtualTokenReserves.isZero();
  } catch {
    return false; // no bonding curve account at all — not a pump.fun mint
  }
}
