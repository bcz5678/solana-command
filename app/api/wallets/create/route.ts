import { requireSuperAdmin } from '@/app/api/require-super-admin'
import { Keypair }           from '@solana/web3.js'
import bs58                  from 'bs58'

export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  let admin
  try {
    ({ admin } = await requireSuperAdmin())
  } catch (e) {
    return e as Response
  }

  const supabase = admin

  let body: {
    numberOfWallets: number
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

  const { numberOfWallets, walletType, ownerID, groupId, groupName } = body

  if (!numberOfWallets || numberOfWallets < 1 || numberOfWallets > 20) {
    return new Response('numberOfWallets must be between 1 and 20', { status: 400 })
  }
  if (!walletType || !ownerID) {
    return new Response('Missing required fields', { status: 400 })
  }

  // Resolve group — use existing id or create new by name
  let resolvedGroupId: number | null = groupId ?? null

  if (!resolvedGroupId && groupName?.trim()) {
    const { data: newGroup, error } = await supabase
      .from('wallet_groups')
      .insert({ name: groupName.trim(), owner_id: ownerID })
      .select('id')
      .single()

    if (error) {
      return Response.json(
        { error: `Failed to create wallet group: ${error.message}` },
        { status: 500 }
      )
    }
    resolvedGroupId = newGroup.id
  }

  if (!resolvedGroupId) {
    return new Response('Wallet group is required', { status: 400 })
  }

  // Generate keypairs server-side — secret keys never touch the browser
  const rows = Array.from({ length: numberOfWallets }, () => {
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
    return row
  })

  const { data, error } = await supabase
    .from('wallets')
    .insert(rows)
    .select('id')

  if (error) return Response.json({ error: error.message }, { status: 500 })

  return Response.json({ count: data.length })
}
