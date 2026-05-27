// app/api/wallets/store-keypair/route.ts

import { NextRequest, NextResponse } from 'next/server'
import { requireSuperAdmin } from '../../../../lib/auth/require-super-admin'

export async function POST(req: NextRequest) {
  let admin, userId
      try {
          ({ admin, userId } = await requireSuperAdmin())
      } catch (e) {
          return e as Response   // the 401 or 403
      }

  // ── 2. Parse body ──────────────────────────────────────────
  let secretKey: number[]
  let publicKey: string

  try {
    ({ secretKey, publicKey } = await req.json())
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  // ── 3. Validate secretKey shape ───────────────────────────
  if (
    !Array.isArray(secretKey)    ||
    secretKey.length !== 64      ||
    typeof secretKey[0] !== 'number'
  ) {
    return NextResponse.json(
      { error: 'Invalid secretKey — must be 64-byte number array' },
      { status: 400 }
    )
  }

  if (!publicKey || typeof publicKey !== 'string') {
    return NextResponse.json(
      { error: 'Missing publicKey' },
      { status: 400 }
    )
  }

  // ── 4. Build deterministic vault name ─────────────────────
  // Scoped to user + pubkey — prevents collisions across users
  const vaultSecretName =
    `wallet_${userId.slice(0, 8)}_${publicKey.slice(0, 8)}_secret`

  // ── 5. Check for duplicate ────────────────────────────────


  const { data: exists, error: dupError } = await admin
    .rpc('check_vault_secret_exists', { p_name: vaultSecretName })

  if (dupError) {
    console.error('[store-keypair] duplicate check failed:', dupError.message)
    return NextResponse.json(
      { error: 'Vault check failed' },
      { status: 500 }
    )
  }

  if (exists) {
    return NextResponse.json(
      { error: 'Wallet keypair already exists in vault' },
      { status: 409 }
    )
  }

  // ── 6. Store in Vault via service_role ────────────────────
  const { error: vaultError } = await admin
    .rpc('store_vault_secret', {
      p_secret:      JSON.stringify(secretKey),
      p_name:        vaultSecretName,
      p_description: `Custodial wallet — user: ${userId} pubkey: ${publicKey}`
    })

  if (vaultError) {
    console.error('[store-keypair] vault error:', vaultError.message)
    return NextResponse.json(
      { error: 'Failed to store keypair in vault' },
      { status: 500 }
    )
  }

  // ── 7. Return vault pointer only — never the secret ───────
  return NextResponse.json(
    { vaultSecretName },
    { status: 201 }
  )
}