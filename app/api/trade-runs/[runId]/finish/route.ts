import { NextRequest, NextResponse } from 'next/server'
import { requireSuperAdmin } from '@/lib/auth/require-super-admin'
import { createClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

type Params = { params: Promise<{ runId: string }> }

export async function POST(req: NextRequest, { params }: Params) {
  try {
    await requireSuperAdmin()
  } catch (res) {
    return res as Response
  }

  const { runId } = await params

  let body: { status?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  if (!body.status) {
    return NextResponse.json({ error: 'status is required' }, { status: 400 })
  }

  const supabase = await createClient()
  const { error } = await supabase.rpc('update_trade_run_status', {
    p_run_id: runId,
    p_status: body.status,
  })

  if (error) {
    console.error('[api/trade-runs/:id/finish] update_trade_run_status error:', error.message)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ success: true })
}
