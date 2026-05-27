// app/api/tokens/claim-vanity/route.ts

import { NextRequest, NextResponse } from 'next/server'
import { createClient }              from '@/lib/supabase/server'
import { createAdminClient }         from '@/lib/supabase/admin'
import { requireSuperAdmin }         from '@/lib/auth/require-super-admin'
import { ClaimVanityResponse }       from '@/lib/types/api'


export async function POST(req: NextRequest) {

  // ── 1. Auth ────────────────────────────────────────────────
  try {
    await requireSuperAdmin()
  } catch (res) {
    return res as Response
  }

  const supabase = await createClient()

  // ── 2. Parse optional filters ──────────────────────────────
  let chain: string = 'solana'
  try {
    const body = await req.json()
    chain      = body.chain ?? 'solana'
  } catch {
    // body is optional — defaults are fine
  }

  // ── 3. Claim a vanity keypair atomically ───────────────────
  // claim_vanity_keypair() uses FOR UPDATE SKIP LOCKED —
  // concurrent requests cannot claim the same keypair
  // Status transitions: 'available' → 'reserved'
  // Reserved keypairs are held until Phase 2 confirms or releases
  const { data: claimed, error: claimError } = await supabase
    .rpc('claim_vanity_keypair', {
      p_chain:         chain,
      p_vanity_prefix: null    // null = any 'pump' suffix keypair
    })
    .returns<{ keypair_id: string; public_key: string; vault_secret_name: string }[]>()
    .single()

  if (claimError || !claimed) {
    console.error('[claim-vanity] error:', claimError?.message)
    return NextResponse.json(
      {
        error: claimError?.message.includes('No available')
          ? 'No vanity keypairs available in pool — import more'
          : 'Failed to claim vanity keypair'
      },
      { status: claimError?.message.includes('No available') ? 503 : 500 }
    )
  }

  // ── 4. Return public key + keypair ID ─────────────────────
  // vault_secret_name is intentionally NOT returned —
  // only the admin Edge Function needs it in Phase 2
  // publicKey is public data — safe to return for metadata use
  const response: ClaimVanityResponse = {
    keypairId: claimed.keypair_id,
    publicKey: claimed.public_key
  }

  return NextResponse.json(response, { status: 200 })
}