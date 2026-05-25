import { requireSuperAdmin } from '@/app/api/require-super-admin'
import { Keypair }           from '@solana/web3.js'
import bs58                  from 'bs58'
import { NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

export async function GET() {
  let admin
  try {
    ({ admin } = await requireSuperAdmin())
  } catch (e) {
    return e as Response
  }

  const [ownersRes, typesRes, groupsRes] = await Promise.all([
    admin.from('wallet_owners').select('id, user_id'),
    admin.from('wallet_types').select('id, name'),
    admin.from('wallet_groups').select('id, name, user_id'),
  ])

  if (ownersRes.error) return Response.json({ error: ownersRes.error.message }, { status: 500 })
  if (typesRes.error)  return Response.json({ error: typesRes.error.message },  { status: 500 })
  if (groupsRes.error) return Response.json({ error: groupsRes.error.message }, { status: 500 })

  const userIds = (ownersRes.data ?? []).map((o) => o.user_id)
  const { data: profiles, error: profilesError } = await admin
    .from('user_profiles')
    .select('id, display_name')
    .in('id', userIds)

  if (profilesError) return Response.json({ error: profilesError.message }, { status: 500 })

  const profileMap = Object.fromEntries(
    (profiles ?? []).map((p) => [p.id, p.display_name])
  )

  const owners = (ownersRes.data ?? []).map((o) => ({
    id:   o.id,
    name: profileMap[o.user_id] ?? 'Unknown',
  }))

  return Response.json({
    owners,
    walletTypes:  typesRes.data,
    walletGroups: groupsRes.data,
  })
}


interface CreateWalletBody {
  publicKey:     string
  label:         string
  chain:         string
  encryptedSeed: string
  iv:            string
  salt:          string
  vaultSecretName:  string  
}

export async function POST(req: Request) {
  let admin
  try {
    ({ admin } = await requireSuperAdmin())
  } catch (e) {
    return e as Response
  }

  let body: {
    walletType:      number
    ownerID:         number
    groupId:         number | null
    groupName:       string | null
  }

  try {
    body = await req.json()
  } catch {
    return new Response('Invalid JSON', { status: 400 })
  }



  const { walletType, ownerID, groupId, groupName } = body


  if (!walletType || !ownerID) {
    return new Response('Missing required fields', { status: 400 })
  }

  let resolvedGroupId: number | null = groupId ?? null

  if (!resolvedGroupId && groupName?.trim()) {
    const { data: ownerRow, error: ownerErr } = await admin
      .from('wallet_owners')
      .select('user_id')
      .eq('id', ownerID)
      .single()

    if (ownerErr || !ownerRow) return Response.json({ error: 'Owner not found' }, { status: 400 })

    const { data: newGroup, error } = await admin
      .from('wallet_groups')
      .insert({ name: groupName.trim(), user_id: ownerRow.user_id })
      .select('id')
      .single()

    if (error) return Response.json({ error: `Failed to create wallet group: ${error.message}` }, { status: 500 })
    resolvedGroupId = newGroup.id
  }

  if (!resolvedGroupId) {
    return new Response('Wallet group is required', { status: 400 })
  }

    const kp = Keypair.generate()
    const row = {
      public_key:     kp.publicKey.toBase58(),
      secret_key:     bs58.encode(kp.secretKey),
      funded:         false,
      wallet_type_id: walletType,
      owner_id:       ownerID,
      group_id:       resolvedGroupId,
    }
    kp.secretKey.fill(0)


  const { data, error } = await admin
    .from('wallets')
    .insert(row)
    .select('id')

  if (error) return Response.json({ error: error.message }, { status: 500 })

  return Response.json({ count: data.length })
}
