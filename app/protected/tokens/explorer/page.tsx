'use client'

import { useState, useEffect } from 'react'
import TokenTable from '@/components/tokens/explorer/explorer-table'

interface ExplorerTokenRow {
  id: number
  created_at: string
  dev_wallet_id: number
  name: string
  symbol: string
  description: string
  mint_secret_key: string | null
  contract_address: string | null
  logo_url: string | null
  launched: boolean | null
  website_url: string | null
  twitter_url: string | null
  telegram_handle: string | null
}

export default function Page() {
  const [tokens, setTokens]     = useState<ExplorerTokenRow[]>([])
  const [walletMap, setWalletMap] = useState<Record<number, string>>({})
  const [error, setError]       = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/token/explorer')
      .then((r) => r.json())
      .then(({ tokens, walletMap, error }) => {
        if (error) { setError(error); return }
        setTokens(tokens ?? [])
        setWalletMap(walletMap ?? {})
      })
      .catch(() => setError('Failed to load tokens'))
  }, [])

  return (
    <div className="flex-1 w-full flex flex-col gap-6 p-4">
      <h1 className="text-2xl font-bold text-black">All Tokens</h1>

      {error && (
        <p className="text-destructive text-sm">Failed to load tokens: {error}</p>
      )}

      <TokenTable tokens={tokens} walletMap={walletMap} />
    </div>
  )
}
