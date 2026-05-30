// app/trade/hooks/useWallets.ts

import { useState, useEffect } from 'react'
import { WalletRecord }        from '@/lib/types/wallet'

interface UseWalletsReturn {
  wallets:  WalletRecord[]
  loading:  boolean
  error:    string | null
  refetch:  () => void
}

export function useWallets(): UseWalletsReturn {
  const [wallets,  setWallets]  = useState<WalletRecord[]>([])
  const [loading,  setLoading]  = useState(true)
  const [error,    setError]    = useState<string | null>(null)
  const [tick,     setTick]     = useState(0)

  useEffect(() => {
    let cancelled = false

    async function load() {
      setLoading(true)
      setError(null)

      try {
        // Fetch wallets with live SOL balances
        const res  = await fetch('/api/wallets?balances=true')
        const data = await res.json()

        if (!res.ok) throw new Error(data.error ?? 'Failed to load wallets')
        if (!cancelled) setWallets(data.wallets ?? [])
      } catch (err) {
        if (!cancelled) setError((err as Error).message)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    load()
    return () => { cancelled = true }
  }, [tick])

  return {
    wallets,
    loading,
    error,
    refetch: () => setTick(t => t + 1)
  }
}
