// lib/trades/context.ts

import { Connection, PublicKey } from '@solana/web3.js'
import { getTokenPreview } from '@/lib/pumpfun/token-snapshot'

export interface TradeLogContext {
  symbol:         string
  exchange:       'pump.fun' | 'jupiter'
  priceImpactPct: number | null
}

/**
 * Best-effort symbol/exchange/price-impact lookup for trade logging.
 * Never throws — a metadata lookup failure must not block a trade or its log
 * entry, so callers always get a usable (if degraded) context back.
 */
export async function getTradeLogContext(mint: PublicKey, connection: Connection): Promise<TradeLogContext> {
  try {
    const preview = await getTokenPreview(mint, connection)
    if (!preview) {
      return { symbol: mint.toBase58().slice(0, 4).toUpperCase(), exchange: 'jupiter', priceImpactPct: null }
    }
    return {
      symbol:         preview.symbol,
      exchange:       preview.curve ? 'pump.fun' : 'jupiter',
      priceImpactPct: preview.priceImpactPct,
    }
  } catch (err) {
    console.error('[getTradeLogContext] lookup failed:', (err as Error).message)
    return { symbol: mint.toBase58().slice(0, 4).toUpperCase(), exchange: 'jupiter', priceImpactPct: null }
  }
}
