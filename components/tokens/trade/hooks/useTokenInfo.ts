// app/trade/hooks/useTokenInfo.ts

import { useState, useCallback } from 'react'

export interface TokenInfo {
  mint:                     string
  name:                     string
  symbol:                   string
  description:              string
  image:                    string
  price_in_sol:             number
  market_cap:               number
  virtual_sol_reserves:     number
  virtual_token_reserves:   number
  real_sol_reserves:        number
  real_token_reserves:      number
  complete:                 boolean   // graduated to Raydium
  usd_market_cap:           number
  bonding_curve:            string
}

interface UseTokenInfoReturn {
  tokenInfo:    TokenInfo | null
  loading:      boolean
  error:        string | null
  fetchToken:   (mint: string) => Promise<void>
  clearToken:   () => void
}

export function useTokenInfo(): UseTokenInfoReturn {
  const [tokenInfo, setTokenInfo] = useState<TokenInfo | null>(null)
  const [loading,   setLoading]   = useState(false)
  const [error,     setError]     = useState<string | null>(null)

  const fetchToken = useCallback(async (mint: string) => {
    if (!mint || mint.length < 32) return

    setLoading(true)
    setError(null)
    setTokenInfo(null)

    try {
      const res = await fetch(`https://pumpportal.fun/api/coins/${mint}`)

      if (!res.ok) {
        throw new Error('Token not found on pump.fun')
      }

      const data: TokenInfo = await res.json()
      setTokenInfo(data)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setLoading(false)
    }
  }, [])

  const clearToken = useCallback(() => {
    setTokenInfo(null)
    setError(null)
  }, [])

  return { tokenInfo, loading, error, fetchToken, clearToken }
}
