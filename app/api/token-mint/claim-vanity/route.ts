// app/api/tokens/claim-vanity/route.ts

import { NextRequest, NextResponse } from 'next/server'
import { createClient }              from '@/lib/supabase/server'
import { requireSuperAdmin }         from '@/lib/auth/require-super-admin'
import { ClaimVanityResponse }       from '@/lib/types/responses'

type ClaimedKeypair = {
  keypair_id:        string
  public_key:        string
  vault_secret_name: string
}

export async function POST(req: NextRequest) {

  // ── 1. Verify super admin ──────────────────────────────────
  // requireSuperAdmin() confirms the caller is in private.super_admins
  // We still use createClient() for the RPC — NOT the admin client.
  // Reason: claim_vanity_keypair() checks auth.uid() internally.
  //         createClient() carries the user JWT → auth.uid() resolves.
  //         createAdminClient() is service_role → auth.uid() = NULL.
  try {
    await requireSuperAdmin()
  } catch (res) {
    return res as Response
  }

  // ── 2. User JWT client ─────────────────────────────────────
  const supabase = await createClient()

  // ── 3. Parse optional chain filter ────────────────────────
  let chain = 'solana'
  try {
    const body = await req.json()
    chain      = body.chain ?? 'solana'
  } catch {
    // body is optional — default to solana
  }

  // ── 4. Claim atomically ────────────────────────────────────
  // Uses FOR UPDATE SKIP LOCKED — concurrent requests safe
  // Status: 'available' → 'reserved'
  // public.claim_vanity_keypair() wrapper checks private.super_admins
  // directly (DB-only check — no JWT app_metadata dependency)
  const { data: claimed, error: claimError } = await supabase
    .rpc('claim_vanity_keypair', {
      p_chain:         chain,
      p_vanity_prefix: null    // null = any 'pump' suffix keypair
    })
    .single() as { data: ClaimedKeypair | null; error: { message: string } | null }


if (claimError || !claimed) {// ← log full error
  return NextResponse.json(
    {
      error: claimError?.message ?? 'Failed to claim vanity keypair',  // ← return raw
      debug: claimError                                                  // ← full object
    },
    { status: 500 }
  )
}

  // ── 5. Return public key + keypair ID only ─────────────────
  // vault_secret_name intentionally excluded — server use only in Phase 2
  // publicKey is public data — safe to return for image/metadata naming
  const response: ClaimVanityResponse = {
    keypairId: claimed.keypair_id,
    publicKey: claimed.public_key
  }

  return NextResponse.json(response, { status: 200 })
}