// lib/trades/log.ts

import { createAdminClient } from '@/lib/supabase/admin'

/**
 * Writes a trade record via the log_trade() security-definer function.
 *
 * This replaces the direct .from('trade_logs').insert() calls in the
 * buy/sell routes, which cannot work — private.trade_logs is not
 * PostgREST-reachable, so those inserts silently target a nonexistent
 * public.trade_logs (or fail on schema exposure).
 *
 * log_trade() is gated on service_role, so this uses the admin client.
 * The routes already hold it for vault access.
 *
 * Logging is best-effort by design: a failed log must never turn a
 * successful on-chain trade into an error response. Failures are
 * logged to console and swallowed.
 */

export interface TradeLogParams {
  walletId:      string
  side:          'BUY' | 'SELL'
  exchange:      'jupiter' | 'pump.fun' | string
  symbol:        string
  toAddress:     string             // mint address traded
  amountSol?:    number | null
  quantity?:     number | null      // token base units
  price?:        number | null
  txSignature?:  string | null
  status?:       'pending' | 'confirmed' | 'failed' | 'cancelled'
  mintId?:       string | null      // FK to token_mints if known
  orderType?:    string
  slippageBps?:  number | null
  priceImpact?:  number | null
  errorMessage?: string | null      // set when status = 'failed'
  rawResponse?:  unknown            // quote payload, tx metadata, etc.
}

// Address -> token_mints.id cache. Only successful (non-null) lookups are
// cached — a miss just costs one extra RPC call next time, which is cheap
// and avoids permanently caching "not launched here yet" for a token that
// gets registered later in this same process's lifetime.
const mintIdCache = new Map<string, string>()

/**
 * Resolves a mint's on-chain address to its private.token_mints.id, if the
 * token was launched through this platform. Best-effort — never throws;
 * a lookup failure just means the trade log row gets mint_id = null.
 */
async function resolveMintId(admin: ReturnType<typeof createAdminClient>, mintAddress: string): Promise<string | null> {
  const cached = mintIdCache.get(mintAddress)
  if (cached) return cached

  try {
    const { data, error } = await admin.rpc('get_token_mint_id_by_pubkey', {
      p_mint_public_key: mintAddress,
    })

    if (error || !data) return null

    mintIdCache.set(mintAddress, data as string)
    return data as string

  } catch (err) {
    console.error('[logTrade] resolveMintId failed:', (err as Error).message)
    return null
  }
}

export async function logTrade(params: TradeLogParams): Promise<string | null> {

  const admin = createAdminClient()

  try {
    const mintId = params.mintId ?? await resolveMintId(admin, params.toAddress)

    const { data, error } = await admin.rpc('log_trade', {
      p_wallet_id:     params.walletId,
      p_side:          params.side,
      p_exchange:      params.exchange,
      p_symbol:        params.symbol,
      p_to_address:    params.toAddress,
      p_amount_sol:    params.amountSol    ?? null,
      p_quantity:      params.quantity     ?? null,
      p_price:         params.price        ?? null,
      p_tx_signature:  params.txSignature  ?? null,
      p_status:        params.status       ?? 'confirmed',
      p_mint_id:       mintId,
      p_order_type:    params.orderType    ?? 'MARKET',
      p_slippage_bps:  params.slippageBps  ?? null,
      p_price_impact:  params.priceImpact  ?? null,
      p_error_message: params.errorMessage ?? null,
      // jsonb param — pass the raw object, NOT JSON.stringify()
      p_raw_response:  (params.rawResponse ?? null) as never
    })

    if (error) {
      console.error('[logTrade] failed:', error.message, {
        side:   params.side,
        wallet: params.walletId,
        tx:     params.txSignature
      })
      return null
    }

    return (data as { log_id: string })?.log_id ?? null

  } catch (err) {
    // Never let a logging failure propagate — the trade already happened
    console.error('[logTrade] unexpected error:', (err as Error).message)
    return null
  }
}