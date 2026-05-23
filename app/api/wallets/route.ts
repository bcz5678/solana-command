import { createClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

export async function GET() {
  const supabase = await createClient()

  const { data: claims } = await supabase.auth.getClaims()
  if (!claims?.claims) return new Response('Unauthorized', { status: 401 })

  const [walletRes, typeRes] = await Promise.all([
    supabase.from('wallets').select('id, public_key, wallet_type_id, solana_balance_in_lamports'),
    supabase.from('wallet_types').select('id, name'),
  ])

  if (walletRes.error) return new Response(walletRes.error.message, { status: 500 })
  if (typeRes.error)   return new Response(typeRes.error.message,   { status: 500 })

  return Response.json({ wallets: walletRes.data, walletTypes: typeRes.data })
}
