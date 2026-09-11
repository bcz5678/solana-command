import { NextRequest, NextResponse } from 'next/server'
import { requireSuperAdmin } from '@/lib/auth/require-super-admin'
import { createClient } from '@/lib/supabase/server'
import { updatePumpFunProfileForWallet } from '@/lib/pumpfun/profile-bot'

export const dynamic = 'force-dynamic'

// Pushes a wallet's SAVED profile (username/bio — see profile-bot.ts for why
// avatar isn't included yet) live to Pump.fun, then marks pumpfun_setup true
// in our own DB only if the push actually succeeded.
export async function POST(req: NextRequest) {
  try {
    await requireSuperAdmin()
  } catch (res) {
    return res as Response
  }

  const body = await req.json().catch(() => ({})) as { walletId?: string }
  const walletId = body.walletId
  if (!walletId) {
    return NextResponse.json({ error: 'walletId is required' }, { status: 400 })
  }

  const supabase = await createClient()

  const { data: profiles, error: listError } = await supabase.rpc('get_wallet_profiles', { target_user_id: null })
  if (listError) {
    console.error('[api/wallet-profiles/publish] get_wallet_profiles error:', listError.message)
    return NextResponse.json({ error: listError.message }, { status: 500 })
  }

  const row = (profiles as { wallet_id: string; username: string | null; bio: string | null }[] | null)
    ?.find((p) => p.wallet_id === walletId)
  if (!row) {
    return NextResponse.json({ error: 'Wallet not found' }, { status: 404 })
  }
  if (!row.username) {
    return NextResponse.json({ error: 'Set a username before publishing to Pump.fun' }, { status: 400 })
  }

  const result = await updatePumpFunProfileForWallet(walletId, {
    username: row.username,
    bio:      row.bio ?? '',
  })

  if (!result.success) {
    return NextResponse.json({ error: result.error ?? 'Pump.fun rejected the update' }, { status: result.status ?? 502 })
  }

  const { error: upsertError } = await supabase.rpc('upsert_wallet_profile', {
    p_wallet_id:     walletId,
    p_pumpfun_setup: true,
  })
  if (upsertError) {
    console.error('[api/wallet-profiles/publish] upsert_wallet_profile error:', upsertError.message)
    return NextResponse.json({ error: `Published to Pump.fun but failed to update our records: ${upsertError.message}` }, { status: 500 })
  }

  return NextResponse.json({ success: true })
}
