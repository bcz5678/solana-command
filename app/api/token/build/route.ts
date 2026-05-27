// app/api/tokens/build/route.ts

import { NextRequest, NextResponse } from 'next/server'
import { createClient }              from '@/lib/supabase/server'
import { requireSuperAdmin }         from '@/lib/auth/require-super-admin'

interface BuildTokenBody {
  keypairId:           string          // from claim-vanity
  devWalletId:         string          // UUID from private.wallets
  tokenName:           string
  tokenSymbol:         string
  description?:        string
  decimals?:           number
  tokenType?:          'fungible' | 'nft' | 'semi_fungible'
  maxSupply?:          number | null
  metadataUri?:        string          // set after image/metadata upload
  freezeAuthorityKey?: string | null
  updateAuthorityKey?: string | null
}

export async function POST(req: NextRequest) {

  // ── 1. Auth ────────────────────────────────────────────────
  try {
    await requireSuperAdmin()
  } catch (res) {
    return res as Response
  }

  const supabase = await createClient()

  // ── 2. Parse + validate ────────────────────────────────────
  let body: BuildTokenBody
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const {
    keypairId, devWalletId,
    tokenName, tokenSymbol,
    description        = null,
    decimals           = 9,
    tokenType          = 'fungible',
    maxSupply          = null,
    metadataUri        = null,
    freezeAuthorityKey = null,
    updateAuthorityKey = null
  } = body

  const missing = ['keypairId', 'devWalletId', 'tokenName', 'tokenSymbol']
    .filter(k => !body[k as keyof BuildTokenBody])

  if (missing.length > 0) {
    return NextResponse.json(
      { error: `Missing fields: ${missing.join(', ')}` },
      { status: 400 }
    )
  }

  // ── 3. Build token draft via SECURITY DEFINER ─────────────
  // build_token_draft() validates:
  //   → vanity keypair is reserved (not available or used)
  //   → dev wallet belongs to the caller (via wallet_owners)
  // Inserts:
  //   → private.token_mints (launch_status = 'draft')
  // Does NOT:
  //   → touch Solana RPC
  //   → sign anything
  //   → change keypair status (stays 'reserved' until launch)
  const { data, error: rpcError } = await supabase
    .rpc('build_token_draft', {
      p_keypair_id:           keypairId,
      p_dev_wallet_id:        devWalletId,
      p_token_name:           tokenName,
      p_token_symbol:         tokenSymbol,
      p_description:          description,
      p_decimals:             decimals,
      p_token_type:           tokenType,
      p_max_supply:           maxSupply,
      p_metadata_uri:         metadataUri,
      p_freeze_authority_key: freezeAuthorityKey,
      p_update_authority_key: updateAuthorityKey
    })

  if (rpcError) {
    console.error('[build_token_draft] error:', rpcError.message)

    // Keypair not reserved — likely expired or already used
    if (rpcError.message.includes('not in reserved state')) {
      return NextResponse.json(
        { error: 'Vanity keypair is no longer reserved — claim a new one' },
        { status: 409 }
      )
    }

    // Dev wallet validation failed
    if (rpcError.message.includes('not owned by caller')) {
      return NextResponse.json(
        { error: 'Dev wallet not found or not owned by you' },
        { status: 403 }
      )
    }

    return NextResponse.json(
      { error: rpcError.message },
      { status: 500 }
    )
  }

  return NextResponse.json({
    mintId:        data.mint_id,
    mintAddress:   data.mint_public_key,   // vanity pubkey (ends in 'pump')
    launchStatus:  data.launch_status      // 'draft'
  }, { status: 201 })
}