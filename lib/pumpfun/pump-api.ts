import { PublicKey } from '@solana/web3.js';
import { TokenApiSnapshot } from '@/lib/types/token-pumpfun';

/** Raw pump.fun coin lookup — null on any failure (not found, network error, bad body). */
export async function fetchPumpCoinApi(mint: PublicKey): Promise<TokenApiSnapshot | null> {
  try {
    const res = await fetch(`https://frontend-api-v3.pump.fun/coins/${mint.toBase58()}`);
    if (!res.ok) return null;
    const text = await res.text();
    if (!text) return null; // pump.fun returns 200 with an empty body for unknown addresses
    return JSON.parse(text) as TokenApiSnapshot;
  } catch {
    return null;
  }
}
