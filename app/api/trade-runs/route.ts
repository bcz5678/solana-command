import { NextRequest, NextResponse } from 'next/server'
import { requireSuperAdmin } from '@/lib/auth/require-super-admin'
import { createClient } from '@/lib/supabase/server'
import type { TradeRun } from '@/lib/types/trade-run'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  try {
    await requireSuperAdmin()
  } catch (res) {
    return res as Response
  }

  const { searchParams } = new URL(req.url)
  const status = searchParams.get('status')
  const limit  = Number(searchParams.get('limit') ?? 100)

  const supabase = await createClient()
  const { data, error } = await supabase.rpc('get_trade_runs', {
    p_status: status,
    p_limit:  limit,
  })

  if (error) {
    console.error('[api/trade-runs] get_trade_runs error:', error.message)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ runs: (data ?? []) as TradeRun[] })
}

interface CreateBody {
  surface?:     string
  mintAddress?: string | null
  label?:       string | null
  totalSteps?:  number | null
}

export async function POST(req: NextRequest) {
  try {
    await requireSuperAdmin()
  } catch (res) {
    return res as Response
  }

  let body: CreateBody
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  if (!body.surface) {
    return NextResponse.json({ error: 'surface is required' }, { status: 400 })
  }

  const supabase = await createClient()
  const { data, error } = await supabase.rpc('create_trade_run', {
    p_surface:      body.surface,
    p_mint_address: body.mintAddress ?? null,
    p_label:        body.label ?? null,
    p_total_steps:  body.totalSteps ?? null,
  })

  if (error) {
    console.error('[api/trade-runs] create_trade_run error:', error.message)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ runId: data as string })
}
