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
  funded:          boolean | null
  walletOwnerId:   string | null
  walletGroupId:   string | null    // FK → public.wallet_groups
  walletTypeId:    string | null    // FK → public.wallet_types
}


export async function POST(req: Request) {
  // ── 1. Auth — MUST use createClient() not createAdminClient() ──
  // createClient() forwards the user's JWT from the request cookies
  // createAdminClient() uses service_role — auth.uid() is NULL inside RPC
  const supabase = await createClient()

  const { data: { user }, error: authError } = await supabase.auth.getUser()

  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }


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
    walletGroupId,
    walletTypeId
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
  // Prevents a user from assigning a wallet to someone else's group
  if (walletGroupId) {
    const { data: group, error: groupError } = await supabase
      .from('wallet_groups')
      .select('id')
      .eq('id', walletGroupId)
      .eq('user_id', user.id)       // RLS also enforces this, but explicit is safer
      .maybeSingle()

    if (groupError || !group) {
      return NextResponse.json(
        { error: 'Wallet group not found or not owned by user' },
        { status: 404 }
      )
    }
  }

    // ── 5. Validate walletTypeId exists ───────────────────────
  // wallet_types is a shared lookup — any authenticated user can use any type
  if (walletTypeId) {
    const { data: type, error: typeError } = await supabase
      .from('wallet_types')
      .select('id')
      .eq('id', walletTypeId)
      .maybeSingle()

    if (typeError || !type) {
      return NextResponse.json(
        { error: 'Wallet type not found' },
        { status: 404 }
      )
    }
  }
 // ── 6. Create wallet in private schema ────────────────────
  // SECURITY DEFINER — inserts private.wallets + private.wallet_recovery
  const { data: walletData, error: rpcError } = await supabase
    .rpc('create_wallet', {
      p_public_key:         publicKey,
      p_label:              label,
      p_chain:              chain,
      p_encrypted_seed:     encryptedSeed,
      p_iv:                 iv,
      p_salt:               salt,
      p_vault_secret_name:  vaultSecretName
    })

  if (rpcError) {
    console.error('[create_wallet] RPC error:', rpcError.message)

    if (rpcError.message.includes('unique')) {
      return NextResponse.json(
        { error: 'Wallet already exists' },
        { status: 409 }
      )
    }

    return NextResponse.json(
      { error: 'Failed to create wallet' },
      { status: 500 }
    )
  }

  const walletId: string = walletData.wallet_id

  // ── 7. Create ownership record in public.wallet_owners ─────
  // This is what links the wallet to a group, type, and owner.
  // RLS policy 'wallet_owners_insert' enforces:
  //   user_id must equal auth.uid() OR caller has can_share permission
  // wallet_public_view automatically reflects this via the join in get_my_wallets()
  const { data: ownerData, error: ownerError } = await supabase
    .from('wallet_owners')
    .insert({
      wallet_id:      walletId,
      user_id:        user.id,              // always the authenticated user
      wallet_type_id: walletTypeId ?? null,
      group_id:       walletGroupId ?? null,
      role:           'sole',               // creator is always sole owner
      can_sign:       true,
      can_view:       true,
      can_share:      false,                // off by default — explicit grant required
      label:          label                 // personal label mirrors wallet label
    })
    .select('id')
    .single()

  if (ownerError) {
    console.error('[wallet_owners] insert error:', ownerError.message)

    // Wallet was created but ownership record failed —
    // log this as a critical inconsistency for manual review
    console.error(
      '[wallet_owners] CRITICAL: wallet created without owner record',
      { walletId, userId: user.id }
    )

    return NextResponse.json(
      {
        error:    'Wallet created but ownership record failed',
        walletId,           // return walletId so client knows wallet exists
        partial:  true      // flag for client to handle recovery
      },
      { status: 500 }
    )
  }

  // ── 8. Return created IDs ──────────────────────────────────
  // wallet_public_view is now automatically updated —
  // it reads from private.wallets joined through wallet_owners
  return NextResponse.json(
    {
      walletId,
      ownerId: ownerData.id
    },
    { status: 201 }
  )
}
