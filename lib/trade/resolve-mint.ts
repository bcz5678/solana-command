import { Connection, PublicKey } from '@solana/web3.js';
import { TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID, NATIVE_MINT } from '@solana/spl-token';
import { OnlinePumpSdk, PUMP_AMM_PROGRAM_ID } from '@nirholas/pump-sdk';

/**
 * Resolves an arbitrary address to a tradeable SPL mint. Trading partners
 * sometimes hand out a PumpSwap pool address instead of a graduated token's
 * actual mint (the pool is what some explorers/UIs surface post-graduation) —
 * this unwraps that back to the real mint so lookups/trades don't fail on it.
 * Anything that's already a mint passes through unchanged.
 */
export async function resolveTradeableMint(connection: Connection, address: PublicKey): Promise<PublicKey> {
  const info = await connection.getAccountInfo(address);
  if (!info) throw new Error(`Account not found: ${address.toBase58()}`);

  if (info.owner.equals(TOKEN_PROGRAM_ID) || info.owner.equals(TOKEN_2022_PROGRAM_ID)) {
    return address; // already a mint
  }

  if (info.owner.equals(PUMP_AMM_PROGRAM_ID)) {
    const sdk = new OnlinePumpSdk(connection);
    const pool = await sdk.fetchPoolByAddress(address);
    return pool.baseMint.equals(NATIVE_MINT) ? pool.quoteMint : pool.baseMint;
  }

  throw new Error(`${address.toBase58()} is not a recognized mint or pool address`);
}
