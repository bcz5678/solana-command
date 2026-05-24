import { createClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

export async function GET() {
  const supabase = await createClient()

  const { data: claims } = await supabase.auth.getClaims()
  if (!claims?.claims) return new Response('Unauthorized', { status: 401 })

  const [tokenRes, walletRes] = await Promise.all([
    supabase
      .from('tokens')
      .select('id, created_at, dev_wallet_id, name, symbol, description, mint_secret_key, contract_address, logo_url, launched, website_url, twitter_url, telegram_handle')
      .order('created_at', { ascending: false }),
    supabase.from('wallets').select('id, public_key'),
  ])

  if (tokenRes.error) return new Response(tokenRes.error.message, { status: 500 })

  const tokens = (tokenRes.data ?? []).map((t) => ({
    ...t,
    logo_url: t.logo_url
      ? supabase.storage.from('token-media').getPublicUrl(t.logo_url).data.publicUrl
      : null,
  }))

  const walletMap = Object.fromEntries(
    (walletRes.data ?? []).map((w) => [w.id, w.public_key]),
  )

  return Response.json({ tokens, walletMap })
}
