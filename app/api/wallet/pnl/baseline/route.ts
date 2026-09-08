import { NextRequest, NextResponse } from 'next/server'
import { requireSuperAdmin } from '@/lib/auth/require-super-admin'
import { createClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

// The PnL panel's manual "reset" control — see supabase/rpc/pnl_baseline.sql
// for why this exists (the panel has no idea about wallet-to-wallet token
// transfers, so old history can make it report a loss that never happened).
export async function POST(req: NextRequest) {
  try {
    await requireSuperAdmin()
  } catch (res) {
    return res as Response
  }

  let body: { since?: string; userId?: string }
  try {
    body = await req.json()
  } catch {
    body = {}
  }

  let since: string | null = null
  if (body.since) {
    const parsed = new Date(body.since)
    if (isNaN(parsed.getTime())) {
      return NextResponse.json({ error: 'since is not a valid date' }, { status: 400 })
    }
    since = parsed.toISOString()
  }

  const supabase = await createClient()
  const { data, error } = await supabase.rpc('set_pnl_baseline', {
    p_since:        since,
    target_user_id: body.userId ?? null,
  })

  if (error) {
    console.error('[api/wallet/pnl/baseline] set_pnl_baseline error:', error.message)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ success: true, since: data })
}

export async function DELETE(req: NextRequest) {
  try {
    await requireSuperAdmin()
  } catch (res) {
    return res as Response
  }

  const { searchParams } = new URL(req.url)
  const userId = searchParams.get('userId')

  const supabase = await createClient()
  const { error } = await supabase.rpc('clear_pnl_baseline', { target_user_id: userId })

  if (error) {
    console.error('[api/wallet/pnl/baseline] clear_pnl_baseline error:', error.message)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ success: true })
}
