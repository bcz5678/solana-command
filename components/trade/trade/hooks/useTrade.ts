// app/trade/hooks/useTrade.ts

import { useState } from 'react'

export type TradeType = 'buy' | 'sell'

export interface TradeParams {
  type:        TradeType
  walletId:    string
  mintAddress: string
  amountInSol: number
  slippage:    number
}

export interface TradeResult {
  signature:      string
  tokenName:      string
  tokenSymbol:    string
  inputAmountSol: number
  expectedTokens: number
  priceImpactPct: string
  graduated:      boolean
  pumpUrl:        string
  explorerUrl:    string
}

interface UseTradeReturn {
  executing:   boolean
  result:      TradeResult | null
  error:       string | null
  execute:     (params: TradeParams) => Promise<void>
  reset:       () => void
}

export function useTrade(): UseTradeReturn {
  const [executing, setExecuting] = useState(false)
  const [result,    setResult]    = useState<TradeResult | null>(null)
  const [error,     setError]     = useState<string | null>(null)

  async function execute(params: TradeParams) {
    setExecuting(true)
    setError(null)
    setResult(null)

    try {
      const endpoint = params.type === 'buy'
        ? '/api/pumpfun/buy'
        : '/api/pumpfun/sell'

      const res  = await fetch(endpoint, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          walletId:    params.walletId,
          mintAddress: params.mintAddress,
          amountInSol: params.amountInSol,
          slippage:    params.slippage
        })
      })

      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Trade failed')

      setResult(data as TradeResult)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setExecuting(false)
    }
  }

  function reset() {
    setResult(null)
    setError(null)
  }

  return { executing, result, error, execute, reset }
}
