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
  const [solUsdPrice, setSolUsdPrice] = useState<number | null>(null)
  const [error, setError]             = useState<string | null>(null)
  const [isLoading, setIsLoading]     = useState(true)

  function refreshWallets() {
    // This page manages retired wallets too (its own Status dropdown filters
    // client-side, defaulting to Active) — every other wallet-picker
    // consumer relies on the API's own default (active-only) instead.
    return fetch('/api/wallets/explorer?activeOnly=false')
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
  }

  useEffect(() => {
    refreshWallets().finally(() => setIsLoading(false))

    fetch('/api/price/sol-usd')
      .then((r) => r.json())
      .then(({ solUsd }) => setSolUsdPrice(typeof solUsd === 'number' ? solUsd : null))
      .catch(() => setSolUsdPrice(null))
  }, [])

  return (
    <div className="flex-1 w-full flex flex-col gap-6 p-4">
      <h1 className="text-2xl text-black font-bold">Wallet Explorer</h1>

      {error && (
        <p className="text-destructive text-sm">Failed to load wallets: {error}</p>
      )}

      {isLoading ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 py-24 text-muted-foreground">
          <span className="size-8 animate-spin rounded-full border-2 border-current border-t-transparent" />
          <p className="text-sm">Fetching wallet balances…</p>
        </div>
      ) : (
        <WalletTable
          wallets={wallets}
          walletTypes={walletTypes}
          owners={owners}
          groups={groups}
          solUsdPrice={solUsdPrice}
          onWalletRetired={refreshWallets}
        />
      )}
    </div>
  )
}
