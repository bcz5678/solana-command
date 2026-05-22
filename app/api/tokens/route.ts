import { createClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

export async function GET() {
  const supabase = await createClient()

  const { data: claims } = await supabase.auth.getClaims()
  if (!claims?.claims) return new Response('Unauthorized', { status: 401 })

  const { data, error } = await supabase
    .from('tokens')
    .select('id, created_at, name, symbol, description, owner_id, dev_wallet_id, contract_address, logo_url, token_meta_url, launched, website_url, twitter_url, telegram_handle')
    .order('launched',    { ascending: true  })
    .order('created_at',  { ascending: false })

  if (error) return new Response(error.message, { status: 500 })

  // Resolve storage paths to full public URLs server-side — never expose raw paths to client
  const tokens = (data ?? []).map((t) => ({
    ...t,
    logo_url: t.logo_url
      ? supabase.storage.from('token-media').getPublicUrl(t.logo_url).data.publicUrl
      : '',
  }))

  return Response.json({ tokens })
}
