import { NextRequest, NextResponse } from 'next/server'
import { requireSuperAdmin } from '@/lib/auth/require-super-admin'
import { createClient } from '@/lib/supabase/server'
import type { TradeRun } from '@/lib/types/trade-run'

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
  const { data, error } = await supabase.rpc('get_trade_run', { p_run_id: runId })

  if (error) {
    console.error('[api/trade-runs/:id] get_trade_run error:', error.message)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const run = (data as TradeRun[] | null)?.[0] ?? null
  if (!run) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  return NextResponse.json({ run })
}
