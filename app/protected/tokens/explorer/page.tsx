import { createClient } from '@/lib/supabase/server'
import TokenTable from '@/components/tokens/explorer/explorer-table'

export default async function Page() {
  const supabase = await createClient()

  const [{ data: tokens, error }, { data: wallets }] = await Promise.all([
    supabase
      .from('tokens')
      .select(
        'id, created_at, dev_wallet_id, name, symbol, description, mint_keypair, contract_address, logo_image_path, launched, website_url, twitter_url, telegram_handle',
      )
      .order('created_at', { ascending: false }),
    supabase.from('wallets').select('id, public_key'),
  ])

  const walletMap = Object.fromEntries(
    (wallets ?? []).map((w) => [w.id, w.public_key]),
  )

  const enrichedTokens = (tokens ?? []).map((t) => ({
    ...t,
    logo_url: t.logo_image_path
      ? supabase.storage.from('token-media').getPublicUrl(t.logo_image_path).data.publicUrl
      : null,
  }))

  return (
    <div className="flex-1 w-full flex flex-col gap-6 p-4">
      <h1 className="text-2xl font-bold text-black">All Tokens</h1>

      {error && (
        <p className="text-destructive text-sm">Failed to load tokens: {error.message}</p>
      )}

      <TokenTable tokens={enrichedTokens} walletMap={walletMap} />
    </div>
  )
}
