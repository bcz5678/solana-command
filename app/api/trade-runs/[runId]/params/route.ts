import { NextRequest, NextResponse } from 'next/server'
import { requireSuperAdmin } from '@/lib/auth/require-super-admin'
import { createClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

type Params = { params: Promise<{ runId: string }> }

// Separate from GET /api/trade-runs/[runId] — that route is polled every
// few seconds for a run's whole lifetime just to read `.control`; this one
// is fetched exactly once, at actual resume time, so the saved plan (which
// can be a sizeable JSON blob for a long wallet schedule) never rides along
// on the hot-path poll.
export async function GET(_req: NextRequest, { params }: Params) {
  try {
    await requireSuperAdmin()
  } catch (res) {
    return res as Response
  }

  const { runId } = await params

  const supabase = await createClient()
  const { data, error } = await supabase.rpc('get_trade_run_params', { p_run_id: runId })

  if (error) {
    console.error('[api/trade-runs/:id/params] get_trade_run_params error:', error.message)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ params: data ?? null })
}
