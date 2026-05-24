import { createClient }      from '@/lib/supabase/server'
import { requireSuperAdmin } from '@/app/api/require-super-admin'

export const dynamic = 'force-dynamic'

export async function GET() {
  const supabase = await createClient()

  const { data: claims } = await supabase.auth.getClaims()
  if (!claims?.claims) return new Response('Unauthorized', { status: 401 })

  const [walletRes, typeRes] = await Promise.all([
    supabase.from('wallet_public_view').select('id, public_key, wallet_type_id, solana_balance_in_lamports'),
    supabase.from('wallet_types').select('id, name'),
  ])

  if (walletRes.error) return new Response(walletRes.error.message, { status: 500 })
  if (typeRes.error)   return new Response(typeRes.error.message,   { status: 500 })

  return Response.json({ wallets: walletRes.data, walletTypes: typeRes.data })
}

export async function POST(req: Request) {
  let admin
  try {
    ({ admin } = await requireSuperAdmin())
  } catch (e) {
    return e as Response
  }

  const supabase = admin

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
