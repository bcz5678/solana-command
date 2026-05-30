'use client'

import { useState, useEffect, useRef } from 'react'
import { cn }                           from '@/lib/utils'
import { Button }                       from '@/components/ui/button'
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
    <div className="relative min-h-screen  text-black flex flex-col items-center px-4 pt-8 pb-16 overflow-x-hidden">

      {/* Ambient glow overlay */}
      <div
        aria-hidden
        className="pointer-events-none fixed inset-0 z-0"
        style={{
          background: [
            'radial-gradient(ellipse 80% 50% at 20% 0%, rgba(0,255,136,0.04) 0%, transparent 60%)',
            'radial-gradient(ellipse 60% 40% at 80% 100%, rgba(0,160,255,0.04) 0%, transparent 60%)',
          ].join(','),
        }}
      />

      <div className="relative z-10 w-full max-w-[520px] flex flex-col gap-5">


        {/* ── BUY / SELL toggle ──────────────────────────────── */}
        <div className="relative grid grid-cols-2 bg-white/[0.03] border border-white/[0.07] rounded-xl p-1">
          {/* sliding pill */}
          <div
            aria-hidden
            className={cn(
              'absolute top-1 h-[calc(100%-8px)] w-[calc(50%-4px)] rounded-[9px] pointer-events-none',
              'bg-gray-200 border border-[#00ff88]/20',
              'transition-[left] duration-200 ease-in-out',
              tradeType === 'buy' ? 'left-1' : 'left-[calc(50%)]'
            )}
          />
          {(['buy', 'sell'] as const).map(t => (
            <button
              key={t}
              onClick={() => { setTradeType(t); reset() }}
              className={cn(
                'relative z-10 flex items-center justify-center gap-2 py-3 rounded-[9px]',
                'font-mono text-xs font-bold tracking-[0.12em] transition-colors duration-200 cursor-pointer',
                t === 'buy'
                  ? (tradeType === 'buy'  ? 'text-black' : 'text-[#4a6070]')
                  : (tradeType === 'sell' ? 'text-black' : 'text-[#4a6070]')
              )}
            >
              <span className="text-base leading-none">{t === 'buy' ? '↗' : '↙'}</span>
              {t.toUpperCase()}
            </button>
          ))}
        </div>

        {/* ── Token Address ──────────────────────────────────── */}
        <div className="flex flex-col gap-2">
          <Label className="font-mono text-[0.6rem] font-bold tracking-[0.18em] text-[#3a5060] uppercase">
            TOKEN ADDRESS
          </Label>
          <div className="relative flex items-center">
            <Input
              value={mintAddress}
              onChange={e => setMintAddress(e.target.value)}
              placeholder="Enter pump.fun token mint address..."
              spellCheck={false}
              autoComplete="off"
              className={cn(
                'h-11 pr-10 rounded-[10px]',
                'font-mono text-[0.72rem] tracking-[0.02em] text-[#c8d4e0]',
                'bg-white/[0.03] border-white/[0.08]',
                'placeholder:text-[#2a4050]',
                'focus-visible:border-[#00ff88]/30 focus-visible:bg-[#00ff88]/[0.03] focus-visible:ring-[#00ff88]/10'
              )}
            />
            {tokenLoading ? (
              <span className="absolute right-3.5 size-3.5 rounded-full border-2 border-[#00ff88]/15 border-t-[#00ff88] animate-spin" />
            ) : mintAddress ? (
              <button
                onClick={() => { setMintAddress(''); clearToken(); reset() }}
                className="absolute right-3.5 leading-none text-sm text-[#3a5060] hover:text-[#ff5566] transition-colors duration-150 cursor-pointer"
              >
                ✕
              </button>
            ) : null}
          </div>
          {tokenError && (
            <p className="flex items-center gap-1.5 font-mono text-[0.65rem] tracking-[0.05em] text-[#ff5566]">
              <span>⚠</span> {tokenError}
            </p>
          )}
        </div>

        {/* ── Token Card ─────────────────────────────────────── */}
        {tokenInfo && <TokenCard tokenInfo={tokenInfo} priceImpact={priceImpact} />}

        {/* ── Graduated Warning ──────────────────────────────── */}
        {tokenInfo?.complete && (
          <div className="flex items-start gap-3.5 rounded-[10px] bg-[#ffc800]/[0.06] border border-[#ffc800]/20 p-4">
            <span className="text-xl leading-none shrink-0">🎓</span>
            <div>
              <strong className="block font-bold text-[#ffc800] text-[0.8rem] mb-1">
                Token Graduated
              </strong>
              <p className="m-0 text-[#8a9090] text-[0.72rem] leading-relaxed">
                This token has moved to Raydium. Use Jupiter route instead.
              </p>
            </div>
          </div>
        )}

        {/* ── Wallet Selector ────────────────────────────────── */}
        <div className="flex flex-col gap-2">
          <Label className="font-mono text-[0.6rem] font-bold tracking-[0.18em] text-[#3a5060] uppercase">
            TRADING WALLET
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
          <div className="flex items-center gap-2.5 rounded-[10px] bg-[#ff5566]/[0.08] border border-[#ff5566]/20 px-4 py-3.5 font-mono text-[0.7rem] tracking-[0.03em] leading-relaxed text-[#ff8090]">
            <span>⚠</span>
            {tradeError}
          </div>
        )}

        {/* ── Submit Button ──────────────────────────────────── */}
        <button
          onClick={handleTrade}
          disabled={!canTrade}
          className={cn(
            'group relative w-full py-[1.125rem] rounded-xl overflow-hidden',
            'flex items-center justify-center gap-2.5',
            'font-mono text-[0.8rem] font-bold tracking-[0.18em]',
            'transition-all duration-200 cursor-pointer',
            tradeType === 'buy'
              ? 'bg-gradient-to-br from-[#00cc70] to-[#009950] text-[#001a0a] shadow-[0_4px_24px_rgba(0,204,112,0.25)]'
              : 'bg-gradient-to-br from-[#ff4455] to-[#cc2233] text-[#1a0005] shadow-[0_4px_24px_rgba(255,68,85,0.25)]',
            'enabled:hover:-translate-y-px enabled:hover:brightness-110',
            'disabled:opacity-30 disabled:cursor-not-allowed disabled:shadow-none'
          )}
        >
          {/* shimmer overlay */}
          <span
            aria-hidden
            className="absolute inset-0 bg-gradient-to-br from-white/8 to-transparent opacity-0 group-enabled:group-hover:opacity-100 transition-opacity duration-200 pointer-events-none"
          />
          {executing ? (
            <>
              <span className="size-3.5 rounded-full border-2 border-current/30 border-t-current animate-spin" />
              EXECUTING...
            </>
          ) : (
            <>
              <span className="text-base leading-none">{tradeType === 'buy' ? '↗' : '↙'}</span>
              {tradeType === 'buy' ? 'BUY TOKEN' : 'SELL TOKEN'}
            </>
          )}
        </button>

        {/* ── Footer ─────────────────────────────────────────── */}
        <footer className="flex justify-center gap-3 font-mono text-[0.6rem] tracking-[0.08em] text-[#2a3a40]">
          <span>Powered by pump.fun protocol</span>
          <span>·</span>
          <span>Slippage {(slippage * 100).toFixed(1)}%</span>
        </footer>

      </div>
    </div>
  )
}
