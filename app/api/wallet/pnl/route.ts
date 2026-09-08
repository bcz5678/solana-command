import { NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { requireSuperAdmin } from "@/lib/auth/require-super-admin";
import type { WalletRecord } from "@/lib/types/wallet";
import { initializeQuickNodeSolana } from "@/app/api/utils/helpers";
import { fetchWalletBalances } from "@/lib/wallet/balances";
import { relay } from "@/lib/wss/relay-instance";

export const dynamic = 'force-dynamic'

interface WalletPnlRow {
  wallet_id:     string
  buy_count:     number
  sell_count:    number
  trade_count:   number
  sol_spent:     number
  sol_received:  number
  net_sol:       number
  last_trade_at: string | null
}

interface TradeFillRow {
  wallet_id:    string
  mint_address: string
  token_symbol: string | null
  token_name:   string | null
  decimals:     number
  side:         'BUY' | 'SELL'
  quantity:     number
  amount_sol:   number
  executed_at:  string
}

interface FifoOpenPosition {
  walletId:         string
  mintAddress:      string
  tokenSymbol:      string | null
  tokenName:        string | null
  decimals:         number
  remainingQtyRaw:  number
  costBasisSol:     number
}

export interface OpenPositionDetail {
  mintAddress:      string
  tokenSymbol:       string | null
  tokenName:         string | null
  remainingTokens:   number
  costBasisSol:      number
  priceSol:          number | null
  marketValueSol:    number | null
  unrealizedPnlSol:  number | null
}

/**
 * Walks each wallet+mint's fills in chronological order (as returned by
 * get_wallet_trade_fills — pre-sorted) consuming FIFO lots, instead of the
 * average-cost blend this used to be. Matters specifically for the
 * sniper-flush pattern (sell part of a position, then rebuy it): a
 * flush-sell consumes the ORIGINAL (oldest) lot first, and the rebuy lands
 * as its own distinct new lot at whatever price it actually cleared —
 * accurately reflecting that what's left afterward may be part of the
 * original buy plus the rebuy, each at its real cost, rather than one
 * blended average across the whole history.
 */
function computeFifoOpenPositions(fills: TradeFillRow[]): FifoOpenPosition[] {
  const results: FifoOpenPosition[] = []
  let i = 0

  while (i < fills.length) {
    const { wallet_id, mint_address, token_symbol, token_name, decimals } = fills[i]
    const lots: { qty: number; costSol: number }[] = []

    while (i < fills.length && fills[i].wallet_id === wallet_id && fills[i].mint_address === mint_address) {
      const fill = fills[i]
      if (fill.side === 'BUY') {
        if (fill.quantity > 0) lots.push({ qty: fill.quantity, costSol: fill.amount_sol })
      } else {
        let toSell = fill.quantity
        while (toSell > 0 && lots.length > 0) {
          const lot = lots[0]
          if (lot.qty <= toSell) {
            toSell -= lot.qty
            lots.shift()
          } else {
            // Partial lot consumption — carry the unsold fraction's own cost
            // forward, not the lot's full original cost.
            const fraction = toSell / lot.qty
            lot.costSol -= lot.costSol * fraction
            lot.qty -= toSell
            toSell = 0
          }
        }
        // toSell > 0 here means this wallet sold more than trade_logs ever
        // saw it buy (history predates our logging, or a data gap) — no lot
        // left to attribute cost to, so the excess is silently dropped
        // rather than going negative.
      }
      i++
    }

    const remainingQtyRaw = lots.reduce((sum, l) => sum + l.qty, 0)
    const costBasisSol    = lots.reduce((sum, l) => sum + l.costSol, 0)
    if (remainingQtyRaw > 0) {
      results.push({ walletId: wallet_id, mintAddress: mint_address, tokenSymbol: token_symbol, tokenName: token_name, decimals, remainingQtyRaw, costBasisSol })
    }
  }

  return results
}

export async function GET(req: NextRequest) {
  let admin, userId
  try {
    ({ admin, userId } = await requireSuperAdmin())
  } catch (e) {
    return e as Response
  }

  // SECURITY DEFINER RPCs resolve auth.uid() from the JWT — user-JWT client, not admin.
  const supabase = await createClient()

  const { searchParams } = new URL(req.url)
  const targetUserId = searchParams.get('userId') ?? null

  const [
    { data: walletResults, error: walletsError },
    { data: pnlResults, error: pnlError },
    { data: fillResults, error: fillsError },
  ] = await Promise.all([
    supabase.rpc('get_wallets', { target_user_id: targetUserId, p_active_only: true }),
    supabase.rpc('get_wallet_pnl_summary', { target_user_id: targetUserId }),
    supabase.rpc('get_wallet_trade_fills', { target_user_id: targetUserId }),
  ])

  if (walletsError) {
    console.error('[wallet/pnl] get_wallets error:', walletsError.message)
    return Response.json({ error: walletsError.message }, { status: 500 })
  }
  if (pnlError) {
    console.error('[wallet/pnl] get_wallet_pnl_summary error:', pnlError.message)
    return Response.json({ error: pnlError.message }, { status: 500 })
  }
  if (fillsError) {
    // Non-fatal — realized PnL still renders fine without the unrealized column.
    console.error('[wallet/pnl] get_wallet_trade_fills error:', fillsError.message)
  }

  const wallets = (walletResults ?? []) as WalletRecord[]
  const pnlByWallet = new Map<string, WalletPnlRow>(
    ((pnlResults ?? []) as WalletPnlRow[]).map((row) => [row.wallet_id, row]),
  )
  const positions = computeFifoOpenPositions((fillResults ?? []) as TradeFillRow[])

  try {
    await fetchWalletBalances(wallets, initializeQuickNodeSolana().connection)
  } catch (error) {
    console.error('[wallet/pnl] balance fetch failed:', error)
  }

  // One relay call per DISTINCT open mint (not per position) — a wallet
  // holding the same mint as ten others still only costs one lookup. The
  // relay's own getTokenState() is on-demand + short-cached (~8s) server-side
  // and backed by a live bonding-curve accountSubscribe for watched mints, so
  // this is the freshest mark price available without this route managing
  // its own watch/subscribe lifecycle. A relay that's down (or a mint it
  // can't price) degrades to priceSol: null for just that mint — the panel
  // shows realized PnL either way, unrealized just goes "unavailable".
  const uniqueMints = [...new Set(positions.map((p) => p.mintAddress))]
  const priceByMint = new Map<string, number | null>()
  await Promise.all(uniqueMints.map(async (mint) => {
    try {
      const state = await relay.getTokenState(mint)
      priceByMint.set(mint, state.priceSol)
    } catch (error) {
      console.warn(`[wallet/pnl] getTokenState failed for ${mint}:`, error instanceof Error ? error.message : error)
      priceByMint.set(mint, null)
    }
  }))

  interface UnrealizedAgg {
    unrealizedPnlSol:  number
    hasUnknownPrice:   boolean
    positions:         OpenPositionDetail[]
  }
  const unrealizedByWallet = new Map<string, UnrealizedAgg>()

  for (const p of positions) {
    const priceSol        = priceByMint.get(p.mintAddress) ?? null
    const remainingTokens = p.remainingQtyRaw / 10 ** p.decimals
    const marketValueSol  = priceSol != null ? remainingTokens * priceSol : null
    const unrealizedSol   = marketValueSol != null ? marketValueSol - p.costBasisSol : null

    const agg = unrealizedByWallet.get(p.walletId) ?? { unrealizedPnlSol: 0, hasUnknownPrice: false, positions: [] }
    if (unrealizedSol != null) agg.unrealizedPnlSol += unrealizedSol
    else agg.hasUnknownPrice = true
    agg.positions.push({
      mintAddress:      p.mintAddress,
      tokenSymbol:      p.tokenSymbol,
      tokenName:        p.tokenName,
      remainingTokens,
      costBasisSol:     p.costBasisSol,
      priceSol,
      marketValueSol,
      unrealizedPnlSol: unrealizedSol,
    })
    unrealizedByWallet.set(p.walletId, agg)
  }

  const rows = wallets.map((w) => {
    const pnl        = pnlByWallet.get(w.id)
    const unrealized = unrealizedByWallet.get(w.id)
    const realizedPnlSol   = pnl?.net_sol ?? 0
    const unrealizedPnlSol = unrealized?.unrealizedPnlSol ?? 0
    return {
      walletId:              w.id,
      label:                 w.label,
      publicKey:              w.public_key,
      walletType:            w.wallet_type ?? null,
      solBalanceLamports:    (w as any).solana_balance_in_lamports ?? 0,
      buyCount:              pnl?.buy_count ?? 0,
      sellCount:             pnl?.sell_count ?? 0,
      tradeCount:            pnl?.trade_count ?? 0,
      solSpent:              pnl?.sol_spent ?? 0,
      solReceived:           pnl?.sol_received ?? 0,
      realizedPnlSol,
      lastTradeAt:           pnl?.last_trade_at ?? null,
      unrealizedPnlSol,
      hasUnknownPrice:       unrealized?.hasUnknownPrice ?? false,
      openPositions:         unrealized?.positions ?? [],
      totalPnlSol:           realizedPnlSol + unrealizedPnlSol,
    }
  })

  return Response.json({
    wallets:    rows,
    fetchedAt:  new Date().toISOString(),
  })
}
