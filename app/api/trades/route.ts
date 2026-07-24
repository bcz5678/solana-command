// app/api/trades/route.ts

import { NextRequest, NextResponse } from 'next/server'
import { createClient }              from '@/lib/supabase/server'
import { requireSuperAdmin }         from '@/lib/auth/require-super-admin'
import type { TradeLog, TradeStats } from '@/lib/types/trades'

const VALID_SIDES    = ['BUY', 'SELL']
const VALID_STATUSES = ['pending', 'confirmed', 'failed', 'cancelled']
const DEFAULT_LIMIT  = 100
const MAX_LIMIT      = 500

export async function GET(req: NextRequest) {

  // ── 1. Auth — super admin only ─────────────────────────────
  try {
    await requireSuperAdmin()
  } catch (res) {
    return res as Response
  }

  // ── 2. User JWT client — required for is_super_admin() ────
  const supabase = await createClient()

  // ── 3. Parse query params ──────────────────────────────────
  const { searchParams } = new URL(req.url)

  const targetUserId = searchParams.get('userId')    ?? null
  const walletId     = searchParams.get('walletId')  ?? null
  const mintId       = searchParams.get('mintId')    ?? null
  const sideRaw      = searchParams.get('side')      ?? null
  const status       = searchParams.get('status')    ?? null
  const exchange     = searchParams.get('exchange')  ?? null
  const fromRaw      = searchParams.get('from')      ?? null
  const toRaw        = searchParams.get('to')        ?? null
  const wantStats    = searchParams.get('stats') === 'true'
  const limit        = Math.min(parseInt(searchParams.get('limit')  ?? String(DEFAULT_LIMIT)) || DEFAULT_LIMIT, MAX_LIMIT)
  const offset       = parseInt(searchParams.get('offset') ?? '0') || 0

  // ── 4. Validate params ──────────────────────────────────────
  const side = sideRaw ? sideRaw.toUpperCase() : null
  if (side && !VALID_SIDES.includes(side)) {
    return NextResponse.json(
      { error: `Invalid side: ${sideRaw}`, valid_sides: VALID_SIDES },
      { status: 400 },
    )
  }

  if (status && !VALID_STATUSES.includes(status)) {
    return NextResponse.json(
      { error: `Invalid status: ${status}`, valid_statuses: VALID_STATUSES },
      { status: 400 },
    )
  }

  const from = fromRaw ? new Date(fromRaw) : null
  if (from && Number.isNaN(from.getTime())) {
    return NextResponse.json({ error: `Invalid from date: ${fromRaw}` }, { status: 400 })
  }

  const to = toRaw ? new Date(toRaw) : null
  if (to && Number.isNaN(to.getTime())) {
    return NextResponse.json({ error: `Invalid to date: ${toRaw}` }, { status: 400 })
  }

  const filterParams = {
    target_user_id: targetUserId,
    p_wallet_id:    walletId,
    p_mint_id:      mintId,
    p_side:         side,
    p_status:       status,
    p_exchange:     exchange,
    p_from:         from ? from.toISOString() : null,
    p_to:           to ? to.toISOString() : null,
  }

  // ── 5. Fetch trades (+ stats, in parallel) ─────────────────
  // Ask for one extra row to detect hasMore without a separate COUNT(*).
  const [tradesResult, statsResult] = await Promise.all([
    supabase.rpc('get_trades', { ...filterParams, p_limit: limit + 1, p_offset: offset }),
    wantStats
      ? supabase.rpc('get_trade_stats', filterParams)
      : Promise.resolve({ data: null, error: null }),
  ]) as [
    { data: TradeLog[] | null; error: { message: string } | null },
    { data: TradeStats[] | null; error: { message: string } | null },
  ]

  if (tradesResult.error) {
    console.error('[trades] get_trades error:', tradesResult.error.message)
    return NextResponse.json({ error: tradesResult.error.message }, { status: 500 })
  }

  if (statsResult.error) {
    console.error('[trades] get_trade_stats error:', statsResult.error.message)
    return NextResponse.json({ error: statsResult.error.message }, { status: 500 })
  }

  const trades  = tradesResult.data ?? []
  const hasMore = trades.length > limit
  const page    = hasMore ? trades.slice(0, limit) : trades

  return NextResponse.json({
    trades: page,
    count:  page.length,
    limit,
    offset,
    hasMore,
    stats:  wantStats ? (statsResult.data?.[0] ?? null) : undefined,
    filters: {
      walletId: walletId ?? 'all',
      mintId:   mintId   ?? 'all',
      side:     side     ?? 'all',
      status:   status   ?? 'all',
      exchange: exchange ?? 'all',
      from:     filterParams.p_from ?? null,
      to:       filterParams.p_to   ?? null,
      userId:   targetUserId ?? 'all',
    },
  }, { status: 200 })
}
