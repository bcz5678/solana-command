'use client'

import { useState, useEffect, useRef } from 'react'
import { cn }                           from '@/lib/utils'
import { Input }                        from '@/components/ui/input'
import { Label }                        from '@/components/ui/label'
import { useTokenInfo }                 from './hooks/useTokenInfo'
import { useWallets }                   from './hooks/useWallets'
import { useTrade, TradeType }          from './hooks/useTrade'
import { TokenCard }                    from './TokenCard'
import { WalletSelector }               from './WalletSelector'
import { AmountInput }                  from './AmountInput'
import { SlippageControl }              from './SlippageControl'
import { TradeResult }                  from './TradeResult'
import { WalletRecord }                 from '@/lib/types/wallet'

export function TokenTradePanel() {
  const [tradeType,      setTradeType]      = useState<TradeType>('buy')
  const [mintAddress,    setMintAddress]    = useState('')
  const [selectedWallet, setSelectedWallet] = useState<WalletRecord | null>(null)
  const [amountInSol,    setAmountInSol]    = useState('')
  const [tokenAmount,    setTokenAmount]    = useState('')
  const [slippage,       setSlippage]       = useState(0.01)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const { tokenInfo, loading: tokenLoading, error: tokenError, fetchToken, clearToken } = useTokenInfo()
  const { wallets,   loading: walletsLoading }                                           = useWallets()
  const { executing, result, error: tradeError, execute, reset }                        = useTrade()

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    if (mintAddress.length >= 32) {
      debounceRef.current = setTimeout(() => fetchToken(mintAddress), 600)
    } else {
      clearToken()
    }
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current) }
  }, [mintAddress, fetchToken, clearToken])

  const estimatedOutput = (() => {
    if (!tokenInfo || !amountInSol) return null
    const sol = parseFloat(amountInSol)
    if (isNaN(sol) || sol <= 0) return null
    const lamports = sol * 1_000_000_000
    const out = (tokenInfo.virtual_token_reserves * lamports) /
                (tokenInfo.virtual_sol_reserves + lamports)
    return (out / 1_000_000).toFixed(2)
  })()

  const estimatedSol = (() => {
    if (!tokenInfo || !tokenAmount) return null
    const tokens = parseFloat(tokenAmount)
    if (isNaN(tokens) || tokens <= 0) return null
    const tokenLamports = tokens * 1_000_000
    const sol = (tokenInfo.virtual_sol_reserves * tokenLamports) /
                (tokenInfo.virtual_token_reserves - tokenLamports)
    return (sol / 1_000_000_000).toFixed(6)
  })()

  const priceImpact = (() => {
    if (!tokenInfo || !amountInSol) return 0
    const sol = parseFloat(amountInSol)
    if (isNaN(sol)) return 0
    return (sol * 1_000_000_000 / tokenInfo.virtual_sol_reserves) * 100
  })()

  const canTrade = (
    !!tokenInfo &&
    !!selectedWallet &&
    !tokenInfo.complete &&
    (tradeType === 'buy' ? !!amountInSol : !!tokenAmount) &&
    !executing
  )

  async function handleTrade() {
    if (!selectedWallet || !tokenInfo) return
    const amount = tradeType === 'buy'
      ? parseFloat(amountInSol)
      : parseFloat(estimatedSol ?? '0')
    if (!amount || amount <= 0) return
    await execute({ type: tradeType, walletId: selectedWallet.id, mintAddress, amountInSol: amount, slippage })
  }

  if (result) {
    return <TradeResult result={result} tradeType={tradeType} onReset={reset} />
  }

  return (
    <div className="w-full max-w-130 mx-auto flex flex-col gap-5 px-4 py-8">

      {/* ── BUY / SELL toggle ──────────────────────────────── */}
      <div className="relative grid grid-cols-2 bg-muted border border-border rounded-xl p-1">
        {/* sliding pill */}
        <div
          aria-hidden
          className={cn(
            'absolute top-1 h-[calc(100%-8px)] w-[calc(50%-4px)] rounded-[9px] pointer-events-none',
            'bg-background shadow-sm border border-border',
            'transition-[left] duration-200 ease-in-out',
            tradeType === 'buy' ? 'left-1' : 'left-[calc(50%)]'
          )}
        />
        {(['buy', 'sell'] as const).map(t => (
          <button
            key={t}
            onClick={() => { setTradeType(t); reset() }}
            className={cn(
              'relative z-10 flex items-center justify-center gap-2 py-2.5 rounded-[9px]',
              'text-sm font-semibold transition-colors duration-200 cursor-pointer',
              t === 'buy'
                ? (tradeType === 'buy'  ? 'text-primary'      : 'text-muted-foreground')
                : (tradeType === 'sell' ? 'text-destructive'  : 'text-muted-foreground')
            )}
          >
            <span className="text-base leading-none">{t === 'buy' ? '↗' : '↙'}</span>
            {t === 'buy' ? 'Buy' : 'Sell'}
          </button>
        ))}
      </div>

      {/* ── Token Address ──────────────────────────────────── */}
      <div className="flex flex-col gap-1.5">
        <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Token Address
        </Label>
        <div className="relative flex items-center">
          <Input
            value={mintAddress}
            onChange={e => setMintAddress(e.target.value)}
            placeholder="Enter pump.fun token mint address…"
            spellCheck={false}
            autoComplete="off"
            className="pr-9 font-mono text-xs"
          />
          {tokenLoading ? (
            <span className="absolute right-3 size-3.5 rounded-full border-2 border-border border-t-primary animate-spin" />
          ) : mintAddress ? (
            <button
              onClick={() => { setMintAddress(''); clearToken(); reset() }}
              className="absolute right-3 text-sm leading-none text-muted-foreground hover:text-destructive transition-colors duration-150 cursor-pointer"
            >
              ✕
            </button>
          ) : null}
        </div>
        {tokenError && (
          <p className="flex items-center gap-1.5 text-xs text-destructive">
            <span>⚠</span> {tokenError}
          </p>
        )}
      </div>

      {/* ── Token Card ─────────────────────────────────────── */}
      {tokenInfo && <TokenCard tokenInfo={tokenInfo} priceImpact={priceImpact} />}

      {/* ── Graduated Warning ──────────────────────────────── */}
      {tokenInfo?.complete && (
        <div className="flex items-start gap-3 rounded-lg bg-amber-50 border border-amber-200 p-4">
          <span className="text-xl leading-none shrink-0">🎓</span>
          <div>
            <strong className="block text-sm font-semibold text-amber-800 mb-0.5">
              Token Graduated
            </strong>
            <p className="m-0 text-xs text-amber-700 leading-relaxed">
              This token has moved to Raydium. Use Jupiter route instead.
            </p>
          </div>
        </div>
      )}

      {/* ── Wallet Selector ────────────────────────────────── */}
      <div className="flex flex-col gap-1.5">
        <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Trading Wallet
        </Label>
        <WalletSelector
          wallets={wallets}
          loading={walletsLoading}
          selected={selectedWallet}
          onSelect={setSelectedWallet}
        />
      </div>

      {/* ── Amount Input ───────────────────────────────────── */}
      <AmountInput
        tradeType={tradeType}
        tokenInfo={tokenInfo}
        amountInSol={amountInSol}
        tokenAmount={tokenAmount}
        estimatedOutput={estimatedOutput}
        estimatedSol={estimatedSol}
        onSolChange={setAmountInSol}
        onTokenChange={setTokenAmount}
      />

      {/* ── Slippage ───────────────────────────────────────── */}
      <SlippageControl value={slippage} onChange={setSlippage} />

      {/* ── Trade Error ────────────────────────────────────── */}
      {tradeError && (
        <div className="flex items-center gap-2 rounded-lg bg-destructive/5 border border-destructive/20 px-4 py-3 text-sm text-destructive">
          <span>⚠</span>
          {tradeError}
        </div>
      )}

      {/* ── Submit Button ──────────────────────────────────── */}
      <button
        onClick={handleTrade}
        disabled={!canTrade}
        className={cn(
          'w-full py-3 rounded-xl flex items-center justify-center gap-2',
          'text-sm font-semibold transition-all duration-200 cursor-pointer',
          tradeType === 'buy'
            ? 'bg-primary text-primary-foreground shadow-sm hover:enabled:opacity-90'
            : 'bg-destructive text-destructive-foreground shadow-sm hover:enabled:opacity-90',
          'enabled:hover:-translate-y-px',
          'disabled:opacity-40 disabled:cursor-not-allowed'
        )}
      >
        {executing ? (
          <>
            <span className="size-4 rounded-full border-2 border-current/30 border-t-current animate-spin" />
            Executing…
          </>
        ) : (
          <>
            <span className="text-base leading-none">{tradeType === 'buy' ? '↗' : '↙'}</span>
            {tradeType === 'buy' ? 'Buy Token' : 'Sell Token'}
          </>
        )}
      </button>

      {/* ── Footer ─────────────────────────────────────────── */}
      <p className="flex justify-center gap-3 text-xs text-muted-foreground">
       
        <span>Slippage {(slippage * 100).toFixed(1)}%</span>
      </p>

    </div>
  )
}
