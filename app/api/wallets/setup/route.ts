import { createClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

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
