import { createClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

// GET — form setup data: owners, wallet types, wallet groups
export async function GET() {
  const supabase = await createClient()

  const { data: claims } = await supabase.auth.getClaims()
  if (!claims?.claims) return new Response('Unauthorized', { status: 401 })

  const [ownersRes, typesRes, groupsRes] = await Promise.all([
    supabase.from('owners').select('id, name'),
    supabase.from('wallet_types').select('id, name'),
    supabase.from('wallet_groups').select('id, name, owner_id'),
  ])

  if (ownersRes.error) return new Response(ownersRes.error.message, { status: 500 })
  if (typesRes.error)  return new Response(typesRes.error.message,  { status: 500 })
  if (groupsRes.error) return new Response(groupsRes.error.message, { status: 500 })

  return Response.json({
    owners:       ownersRes.data,
    walletTypes:  typesRes.data,
    walletGroups: groupsRes.data,
  })
}

// POST — create wallet group if needed, then insert wallet
export async function POST(req: Request) {
  const supabase = await createClient()

  const { data: claims } = await supabase.auth.getClaims()
  if (!claims?.claims) return new Response('Unauthorized', { status: 401 })

  let body: {
    publicKey:  string
    privateKey: string
    funded:     boolean
    walletType: number
    ownerID:    number
    groupId:    number | null
    groupName:  string | null
  }

  try {
    body = await req.json()
  } catch {
    return new Response('Invalid JSON', { status: 400 })
  }

  const { publicKey, privateKey, funded, walletType, ownerID, groupId, groupName } = body

  if (!publicKey || !privateKey || funded === undefined || !walletType || !ownerID) {
    return new Response('Missing required fields', { status: 400 })
  }

  // Resolve group — use existing id or create a new group by name
  let resolvedGroupId: number | null = groupId ?? null

  if (!resolvedGroupId && groupName?.trim()) {
    const { data: newGroup, error } = await supabase
      .from('wallet_groups')
      .insert({ name: groupName.trim(), owner_id: ownerID })
      .select('id')
      .single()

    if (error) return Response.json({ error: `Failed to create wallet group: ${error.message}`, code: error.code }, { status: 500 })
    resolvedGroupId = newGroup.id
  }

  if (!resolvedGroupId) {
    return new Response('Wallet group is required', { status: 400 })
  }

  const { error } = await supabase
    .from('wallets')
    .insert([{
      public_key:     publicKey,
      private_key:    privateKey,
      funded,
      wallet_type_id: walletType,
      owner_id:       ownerID,
      group_id:       resolvedGroupId,
    }])

  if (error) return Response.json({ error: error.message, code: error.code }, { status: 500 })

  return Response.json({ success: true })
}
