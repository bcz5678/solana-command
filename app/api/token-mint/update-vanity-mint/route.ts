// app/api/tokens/update-vanity-mint/route.ts

import { NextRequest, NextResponse } from 'next/server'
import { createClient }              from '@/lib/supabase/server'
import { requireSuperAdmin }         from '@/lib/auth/require-super-admin'

type VanityKeypairStatus = 'available' | 'reserved' | 'used' | 'revoked'

interface UpdateVanityMintBody {
  keypairId: string
  status:    VanityKeypairStatus
}

export async function PATCH(req: NextRequest) {

  // ── 1. Auth — super admin only ─────────────────────────────
  try {
    await requireSuperAdmin()
  } catch (res) {
    return res as Response
  }

  const supabase = await createClient()

  // ── 2. Parse body ──────────────────────────────────────────
  let body: UpdateVanityMintBody
  try {
    body = await req.json()
  } catch {
    return NextResponse.json(
      { error: 'Invalid JSON body' },
      { status: 400 }
    )
  }

  const { keypairId, status } = body

  // ── 3. Validate ────────────────────────────────────────────
  if (!keypairId) {
    return NextResponse.json(
      { error: 'keypairId is required' },
      { status: 400 }
    )
  }

  const validStatuses: VanityKeypairStatus[] = [
    'available', 'reserved', 'used', 'revoked'
  ]

  if (!validStatuses.includes(status)) {
    return NextResponse.json(
      {
        error:          `Invalid status: ${status}`,
        valid_statuses: validStatuses
      },
      { status: 400 }
    )
  }

  // ── 4. Update status via SECURITY DEFINER ─────────────────
  const { data, error: rpcError } = await supabase
    .rpc('update_vanity_keypair_status', {
      p_keypair_id: keypairId,
      p_status:     status
    })

  if (rpcError) {
    console.error('[update_vanity_keypair_status] error:', rpcError.message)

    if (rpcError.message.includes('not found')) {
      return NextResponse.json(
        { error: `Keypair ${keypairId} not found` },
        { status: 404 }
      )
    }

    if (rpcError.message.includes('permanently used')) {
      return NextResponse.json(
        { error: 'Keypair is permanently used — status cannot be changed' },
        { status: 409 }
      )
    }

    return NextResponse.json(
      { error: rpcError.message },
      { status: 500 }
    )
  }

  return NextResponse.json(data, { status: 200 })
}