import { NextRequest, NextResponse } from 'next/server'
import { requireSuperAdmin } from '@/lib/auth/require-super-admin'
import { createClient } from '@/lib/supabase/server'
import type { TradeRunStep } from '@/lib/types/trade-run'

export const dynamic = 'force-dynamic'

type Params = { params: Promise<{ runId: string }> }

export async function GET(_req: NextRequest, { params }: Params) {
  try {
    await requireSuperAdmin()
  } catch (res) {
    return res as Response
  }

  const { runId } = await params

  const supabase = await createClient()
  const { data, error } = await supabase.rpc('get_trade_run_steps', { p_run_id: runId })

  if (error) {
    console.error('[api/trade-runs/:id/steps] get_trade_run_steps error:', error.message)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ steps: (data ?? []) as TradeRunStep[] })
}

interface StepBody {
  stepKey?:   string
  stepIndex?: number | null
  walletId?:  string | null
  status?:    string
  amount?:    string | null
  signature?: string | null
  error?:     string | null
}

export async function POST(req: NextRequest, { params }: Params) {
  try {
    await requireSuperAdmin()
  } catch (res) {
    return res as Response
  }

  const { runId } = await params

  let body: StepBody
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  if (!body.stepKey || !body.status) {
    return NextResponse.json({ error: 'stepKey and status are required' }, { status: 400 })
  }

  const supabase = await createClient()
  const { error } = await supabase.rpc('upsert_trade_run_step', {
    p_run_id:     runId,
    p_step_key:   body.stepKey,
    p_step_index: body.stepIndex ?? null,
    p_wallet_id:  body.walletId ?? null,
    p_status:     body.status,
    p_amount:     body.amount ?? null,
    p_signature:  body.signature ?? null,
    p_error:      body.error ?? null,
  })

  if (error) {
    console.error('[api/trade-runs/:id/steps] upsert_trade_run_step error:', error.message)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ success: true })
}
