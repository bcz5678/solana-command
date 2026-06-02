// app/api/tokens/update-token-draft/route.ts

import { NextRequest, NextResponse } from 'next/server'
import { createClient }              from '@/lib/supabase/server'
import { requireSuperAdmin }         from '@/lib/auth/require-super-admin'

/**
 * Three-state field semantics for ALL nullable fields:
 *
 *   field omitted / undefined   → keep existing value (no change)
 *   field = "some value"        → set / update the value
 *   field = ""  (empty string)  → clear the value to NULL  (REMOVE)
 *
 * The route maps:
 *   undefined  → null  (SQL COALESCE/CASE keeps existing)
 *   ""         → ""    (SQL NULLIF converts to NULL = clear)
 *   "value"    → "value" (SQL sets it)
 *
 * Updates are rejected if launch_status != 'draft' (enforced in SQL,
 * with a pre-check here for a cleaner error response).
 */

interface UpdateTokenDraftBody {
  mintId: string   // required — identifies the draft

  // ── Text fields (three-state) ────────────────────────────
  tokenName?:       string
  tokenSymbol?:     string
  description?:     string

  // ── Link fields (three-state — '' clears) ────────────────
  logoUrl?:         string
  websiteUrl?:      string
  twitterUrl?:      string
  telegramHandle?:  string
  tiktokUrl?:       string
  instagramUrl?:    string
  discordUrl?:      string
  communitiesUrl?:  string

  // ── Numeric / config (omit = keep) ───────────────────────
  decimals?:        number
  maxSupply?:       number | null
  metadataUri?:     string

  // ── Authority keys ───────────────────────────────────────
  freezeAuthorityKey?: string
  updateAuthorityKey?: string

  // ── Dev wallet reassignment ──────────────────────────────
  devWalletId?:     string
}

// Maps an optional incoming value to what the SQL function expects.
// undefined → null (keep existing). '' and real strings pass through.
function passthrough(v: string | undefined): string | null {
  return v === undefined ? null : v
}

export async function POST(req: NextRequest) {

  // ── 1. Auth — super admin only ─────────────────────────────
  try {
    await requireSuperAdmin()
  } catch (res) {
    return res as Response
  }

  const supabase = await createClient()

  // ── 2. Parse body ──────────────────────────────────────────
  let body: UpdateTokenDraftBody
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const { mintId } = body

  if (!mintId) {
    return NextResponse.json(
      { error: 'mintId is required' },
      { status: 400 }
    )
  }

  // ── 3. Confirm at least one field is being changed ─────────
  const updatableKeys: (keyof UpdateTokenDraftBody)[] = [
    'tokenName', 'tokenSymbol', 'description',
    'logoUrl', 'websiteUrl', 'twitterUrl', 'telegramHandle',
    'tiktokUrl', 'instagramUrl', 'discordUrl', 'communitiesUrl',
    'decimals', 'maxSupply', 'metadataUri',
    'freezeAuthorityKey', 'updateAuthorityKey', 'devWalletId'
  ]

  const provided = updatableKeys.filter(k => body[k] !== undefined)

  if (provided.length === 0) {
    return NextResponse.json(
      {
        error:           'No updatable fields provided',
        updatable_fields: updatableKeys
      },
      { status: 400 }
    )
  }

  // ── 4. Pre-check launch_status (cleaner error than SQL raise) ──
  // get_token_mints() returns launch_status — find this token
  const { data: existing, error: lookupError } = await supabase
    .rpc('get_token_mints', { target_user_id: null })

  const token = (existing as { id: string; launch_status: string }[] | null)
    ?.find(t => t.id === mintId)

  if (lookupError) {
    return NextResponse.json(
      { error: lookupError.message },
      { status: 500 }
    )
  }

  if (!token) {
    return NextResponse.json(
      { error: `Token mint ${mintId} not found or not accessible` },
      { status: 404 }
    )
  }

  if (token.launch_status !== 'draft') {
    return NextResponse.json(
      {
        error:         'Token can no longer be edited',
        launch_status: token.launch_status,
        hint:          'Only tokens in draft status can be updated'
      },
      { status: 409 }
    )
  }

  // ── 5. Validate numeric fields if provided ────────────────
  if (body.decimals !== undefined) {
    if (!Number.isInteger(body.decimals) || body.decimals < 0 || body.decimals > 9) {
      return NextResponse.json(
        { error: 'decimals must be an integer between 0 and 9' },
        { status: 400 }
      )
    }
  }

  if (body.maxSupply !== undefined && body.maxSupply !== null) {
    if (body.maxSupply <= 0) {
      return NextResponse.json(
        { error: 'maxSupply must be greater than 0' },
        { status: 400 }
      )
    }
  }

  // ── 6. Call update_token_draft() ───────────────────────────
  // SQL enforces:
  //   → ownership (caller owns the token or super admin)
  //   → draft-only guard (redundant with pre-check, but authoritative)
  //   → dev wallet validation (if devWalletId provided)
  //   → three-state logic via CASE + NULLIF
  const { data, error: rpcError } = await supabase
    .rpc('update_token_draft', {
      p_mint_id:              mintId,

      // Text — passthrough preserves '' for explicit clears
      p_token_name:           passthrough(body.tokenName),
      p_token_symbol:         passthrough(body.tokenSymbol),
      p_description:          passthrough(body.description),

      // Links — '' clears, value sets, null keeps
      p_logo_url:             passthrough(body.logoUrl),
      p_website_url:          passthrough(body.websiteUrl),
      p_twitter_url:          passthrough(body.twitterUrl),
      p_telegram_handle:      passthrough(body.telegramHandle),
      p_tiktok_url:           passthrough(body.tiktokUrl),
      p_instagram_url:        passthrough(body.instagramUrl),
      p_discord_url:          passthrough(body.discordUrl),
      p_communities_url:      passthrough(body.communitiesUrl),

      // Numeric / config — undefined → null (keep)
      p_decimals:             body.decimals    ?? null,
      p_metadata_uri:         passthrough(body.metadataUri),
      p_max_supply:           body.maxSupply   ?? null,

      // Authority keys
      p_freeze_authority_key: passthrough(body.freezeAuthorityKey),
      p_update_authority_key: passthrough(body.updateAuthorityKey),

      // Dev wallet
      p_dev_wallet_id:        body.devWalletId ?? null
    })

  if (rpcError) {
    console.error('[update-token-draft] RPC error:', rpcError.message)

    // Already launched (race — status changed between pre-check and RPC)
    if (rpcError.message.includes('cannot be edited')) {
      return NextResponse.json(
        {
          error: rpcError.message,
          hint:  'Token status changed — only drafts can be edited'
        },
        { status: 409 }
      )
    }

    // Token not found
    if (rpcError.message.includes('not found')) {
      return NextResponse.json(
        { error: `Token mint ${mintId} not found` },
        { status: 404 }
      )
    }

    // Ownership violation
    if (rpcError.message.includes('not owned by caller')) {
      return NextResponse.json(
        { error: 'Token not owned by you' },
        { status: 403 }
      )
    }

    // Dev wallet validation
    if (rpcError.message.includes('Dev wallet')) {
      return NextResponse.json(
        { error: rpcError.message },
        { status: 403 }
      )
    }

    return NextResponse.json(
      { error: rpcError.message },
      { status: 500 }
    )
  }

  // ── 7. Return updated record ───────────────────────────────
  return NextResponse.json(
    {
      updated:        true,
      fieldsChanged:  provided,
      ...data
    },
    { status: 200 }
  )
}
