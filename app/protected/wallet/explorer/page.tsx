import { createClient } from '@/lib/supabase/server'
import { WalletTable } from '@/components/wallet/explorer/explorer-table'

export default async function Page() {
  const supabase = await createClient()

  const [
    { data: wallets, error },
    { data: walletTypes },
    { data: owners },
    { data: groups },
  ] = await Promise.all([
    supabase
      .from('wallets')
      .select('id, created_at, public_key, funded, wallet_type_id, solana_balance_in_lamports, owner_id, group_id, token_holdings'),
    supabase.from('wallet_type').select('id, name'),
    supabase.from('owners').select('id, name'),
    supabase.from('wallet_groups').select('id, name'),
  ])

  return (
    <div className="flex-1 w-full flex flex-col gap-6 p-4">
      <h1 className="text-2xl text-black font-bold">Wallet Explorer</h1>

      {error && (
        <p className="text-destructive text-sm">Failed to load wallets: {error.message}</p>
      )}

      <WalletTable
        wallets={wallets ?? []}
        walletTypes={walletTypes ?? []}
        owners={owners ?? []}
        groups={groups ?? []}
      />
    </div>
  )
}
