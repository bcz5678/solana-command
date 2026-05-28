import { createClient }      from '@/lib/supabase/server'
import { requireSuperAdmin } from '@/lib/auth/require-super-admin'
import { NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

export async function GET() {
  let admin, userId
      try {
          ({ admin, userId } = await requireSuperAdmin())
      } catch (e) {
          return e as Response   // the 401 or 403
      }
  
  const { data: walletTypes,  error: typesError }   =  await admin.from('wallet_types').select('*');
  const { data: walletGroups, error: ownersError }  =  await admin.from('wallet_groups').select('*');


  console.log(`typeRes:  ${walletTypes}`);
  console.log(`groupRes: ${walletGroups}`);


  return Response.json({
    walletTypes:  walletTypes  ?? [],
    walletGroups: walletGroups ?? [],
  })
}


interface CreateWalletBody {
  publicKey:       string
  label:           string
  chain:           string
  encryptedSeed:   string
  iv:              string
  salt:            string
  vaultSecretName: string
  walletGroupId:   string | null
  walletTypeId:    string | null
}

export async function POST(req: NextRequest) {

  // ── 1. Auth ────────────────────────────────────────────────
  const supabase = await createClient()

  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // ── 2. Parse body ──────────────────────────────────────────
  let body: CreateWalletBody
  try {
    body = await req.json()
    } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const {
    publicKey, label, chain,
    encryptedSeed, iv, salt,
    vaultSecretName,
    walletGroupId  = null,
    walletTypeId   = null
  } = body

  // ── 3. Validate required fields ────────────────────────────
  const missing = [
    'publicKey', 'label', 'chain',
    'encryptedSeed', 'iv', 'salt', 'vaultSecretName'
  ].filter(k => !body[k as keyof CreateWalletBody])

  if (missing.length > 0) {
    return NextResponse.json(
      { error: `Missing required fields: ${missing.join(', ')}` },
      { status: 400 }
    )
  }

  // ── 4. Validate walletGroupId belongs to this user ─────────
  if (walletGroupId) {
    const { data: group } = await supabase
      .from('wallet_groups')
      .select('id')
      .eq('id', walletGroupId)
      .eq('user_id', user.id)
      .maybeSingle()

    if (!group) {
      return NextResponse.json(
        { error: 'Wallet group not found or not owned by user' },
        { status: 404 }
      )
    }
  }

  // ── 5. Validate walletTypeId exists ───────────────────────
  if (walletTypeId) {
    const { data: type } = await supabase
      .from('wallet_types')
      .select('id')
      .eq('id', walletTypeId)
      .maybeSingle()

    if (!type) {
      return NextResponse.json(
        { error: 'Wallet type not found' },
        { status: 404 }
      )
    }
  }

  // ── 6. Create wallet via SECURITY DEFINER ─────────────────
  const { data: walletData, error: rpcError } = await supabase
    .rpc('create_wallet', {
      p_public_key:        publicKey,
      p_label:             label,
      p_chain:             chain,
      p_encrypted_seed:    encryptedSeed,
      p_iv:                iv,
      p_salt:              salt,
      p_vault_secret_name: vaultSecretName
    })

  if (rpcError) {
    console.error('[create-wallet] RPC error:', rpcError.message)

    if (rpcError.message.includes('unique')) {
      return NextResponse.json(
        { error: 'Wallet already exists' },
        { status: 409 }
      )
    }

    return NextResponse.json(
      { error: rpcError.message },
      { status: 500 }
    )
  }

  const walletId: string = walletData.wallet_id

  console.log('[create-wallet] wallet created:', walletId)
  console.log('[create-wallet] inserting wallet_owner:', {
    wallet_id:      walletId,
    user_id:        user.id,
    wallet_type_id: walletTypeId,   // maps to wallet_owners.wallet_type_id
    group_id:       walletGroupId,  // maps to wallet_owners.group_id
  })

  // ── 7. Create ownership record ─────────────────────────────
  // Column names must match wallet_owners table exactly:
  //   wallet_type_id  → wallet_owners.wallet_type_id
  //   group_id        → wallet_owners.group_id  (NOT wallet_group_id)
  const { data: ownerData, error: ownerError } = await supabase
    .from('wallet_owners')
    .insert({
      wallet_id:      walletId,
      user_id:        user.id,
      wallet_type_id: walletTypeId   ?? null,  // ← wallet_owners.wallet_type_id
      group_id:       walletGroupId  ?? null,  // ← wallet_owners.group_id
      role:           'sole',
      can_sign:       true,
      can_view:       true,
      can_share:      false,
      label:          label,
      is_active:      true
    })
    .select(`
      id,
      wallet_id,
      user_id,
      wallet_type_id,
      group_id,
      role,
      can_sign,
      can_view,
      can_share,
      granted_at
    `)
    .single()

  console.log('[create-wallet] ownerData:', ownerData)
  console.log('[create-wallet] ownerError:', ownerError?.message)

  if (ownerError) {
    console.error('[create-wallet] CRITICAL: wallet created without owner record', {
      walletId,
      userId:        user.id,
      walletTypeId,
      walletGroupId,
      error:         ownerError.message
    })

    return NextResponse.json(
      {
        error:    'Wallet created but ownership record failed',
        walletId,
        partial:  true,
        detail:   ownerError.message
      },
      { status: 500 }
    )
  }

  // ── 8. Return created record ───────────────────────────────
  return NextResponse.json(
    {
      walletId,
      ownerId:       ownerData.id,
      walletTypeId:  ownerData.wallet_type_id,
      walletGroupId: ownerData.group_id
    },
    { status: 201 }
  )
}
