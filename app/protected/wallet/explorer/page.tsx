'use client'

import { useState, useEffect } from 'react'
import { WalletTable } from '@/components/wallet/explorer/explorer-table'
import type { WalletRecord } from '@/lib/types/wallet'
import { lamportsStringToBN } from '@/lib/lamports'

type LookupEntry = { id: string; name: string }

export default function Page() {
  const [wallets, setWallets]         = useState<WalletRecord[]>([])
  const [walletTypes, setWalletTypes] = useState<LookupEntry[]>([])
  const [owners, setOwners]           = useState<LookupEntry[]>([])
  const [groups, setGroups]           = useState<LookupEntry[]>([])
  const [error, setError]             = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/wallets/explorer')
      .then((r) => r.json())
      .then(({ wallets, walletTypes, owners, groups }) => {
        const parsed: WalletRecord[] = (wallets ?? []).map((w: any) => ({
          ...w,
          solana_balance_in_lamports: w.solana_balance_in_lamports != null
            ? lamportsStringToBN(String(w.solana_balance_in_lamports))
            : null,
        }))
        setWallets(parsed)
        setWalletTypes(walletTypes ?? [])
        setOwners(owners ?? [])
        setGroups(groups ?? [])
      })
      .catch(() => setError('Failed to load wallets'))
  }, [])

  return (
    <div className="flex-1 w-full flex flex-col gap-6 p-4">
      <h1 className="text-2xl text-black font-bold">Wallet Explorer</h1>

      {error && (
        <p className="text-destructive text-sm">Failed to load wallets: {error}</p>
      )}

      <WalletTable
        wallets={wallets}
        walletTypes={walletTypes}
        owners={owners}
        groups={groups}
      />
    </div>
  )
}
