'use client'

import { useState, useEffect, useRef } from 'react'
import BN from 'bn.js'
import { cn }                           from '@/lib/utils'
import { Input }                        from '@/components/ui/input'
import { Label }                        from '@/components/ui/label'
import { TokenSnapshot } from '@/lib/types/token-pumpfun'
import { PublicKey } from '@solana/web3.js'
import { solStringToLamports, lamportsBNToSolDisplay, lamportsStringToBN } from '@/lib/lamports'
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

  const [tokenLoading, setTokenLoading]  = useState(false);
  const [tokenError, setTokenError] = useState('');
  const [tokenInfo, setTokenInfo] = useState<TokenSnapshot | null>(null);
  
  const [wallets, setWallets] = useState<WalletRecord[]>([]);
  const [walletsLoading, setWalletsLoading ] = useState<boolean>(false);

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [debouncedMint, setDebouncedMint] = useState('')

    
  const [tradeResult, setTradeResult] = useState(null);
  const [tradeError, setTradeError] = useState('');
  const [executingTrade, setExecutingTrade] = useState(false);

  useEffect(() => {
    setWalletsLoading(true)
    getWalletsList()
      .then(result => { if (result) setWallets(result) })
      .finally(() => setWalletsLoading(false))
  }, [])

    // Debounce mint address input — fetch token after 600ms pause
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)

    if (mintAddress.length >= 32) {
      debounceRef.current = setTimeout(() => {
        setDebouncedMint(mintAddress)
        fetchToken(mintAddress)
      }, 1000)
    } else {
      clearToken()
    }

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [mintAddress, fetchToken, clearToken])



  async function getWalletsList(): Promise<WalletRecord[] | null> {
    try {
      const res = await fetch('/api/wallets/explorer')
      if (!res.ok) return null
      const { wallets } = await res.json()
      return (wallets ?? []).map((w: any) => ({
        ...w,
        solana_balance_in_lamports: w.solana_balance_in_lamports != null
          ? lamportsStringToBN(String(w.solana_balance_in_lamports))
          : null,
      })) as WalletRecord[]
    } catch {
      return null
    }
  }

  async function fetchToken(mint: string): Promise<void> {
    try {
      const res = await fetch(`/api/pumpfun/token-info?mintAddress=${encodeURIComponent(mint)}`)
      if (!res.ok) throw new Error('Token not found')
      const { body: { snapshot: raw } } = await res.json()

      // BN fields arrive as hex strings (BN.toJSON → hex).
      // PublicKey fields arrive as base58 strings (PublicKey.toJSON → toBase58).
      const snapshot = {
        ...raw,
        virtualSolReserves:     new BN(raw.virtualSolReserves,   16),
        virtualTokenReserves:   new BN(raw.virtualTokenReserves, 16),
        totalSupply:            new BN(raw.totalSupply,           16),
        realSolReserves:        new BN(raw.realSolReserves,       16),
        realTokenReserves:      new BN(raw.realTokenReserves,     16),
        initialMarketCap:       new BN(raw.initialMarketCap,      16),
        marketCap:              new BN(raw.marketCap,             16),
        athMarketCap:           new BN(raw.athMarketCap,          16),
        mint:                   new PublicKey(raw.mint),
        bondingCurve:           new PublicKey(raw.bondingCurve),
        associatedBondingCurve: new PublicKey(raw.associatedBondingCurve),
        creator:                new PublicKey(raw.creator),
      } as unknown as TokenSnapshot

      setTokenInfo(snapshot)
    } catch (error) {
      setTokenError(error instanceof Error ? error.message : 'Failed to load token')
    }
  }

  function reset () {
    setTradeResult(null)
    setTradeError('');
  }

   function clearToken() {
    setTokenInfo(null);
    setTokenError('');
  }

  async function handleTrade() {
    console.log(`button test - selectedWallet: ${selectedWallet?.id}`);
    console.log(`button test - tokenInfo: ${tokenInfo}`);

    if (!selectedWallet || !tokenInfo || tokenInfo.complete) return

  

    let lamports: BN
    try { lamports = solStringToLamports(amountInSol) } catch { return }
    if (lamports.isZero()) return

    setExecutingTrade(true)
    setTradeError('')

    try {
      const res = await fetch('/api/pumpfun/buy', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          walletId:    selectedWallet.id,
          mintAddress,
          amountInSol: lamports.toString(),
          slippage,
        }),
      })

      const data = await res.json()

      if (!res.ok) {
        setTradeError(data.error ?? 'Trade failed')
        return
      }

      setTradeResult(data)
    } catch {
      setTradeError('Network error — please try again')
    } finally {
      setExecutingTrade(false)
    }
  }



  const estimatedOutput = (() => {
    if (!tokenInfo || !amountInSol) return null
    let lamports: BN
    try { lamports = solStringToLamports(amountInSol) } catch { return null }
    if (lamports.isZero()) return null
    const TOKEN_UNIT = new BN(1_000_000)
    const out = tokenInfo.virtualTokenReserves
      .mul(lamports)
      .div(tokenInfo.virtualSolReserves.add(lamports))
    const whole = out.div(TOKEN_UNIT).toString()
    const frac  = out.mod(TOKEN_UNIT).toString().padStart(6, '0').slice(0, 2)
    return `${whole}.${frac}`
  })()

  const estimatedSol = (() => {
    if (!tokenInfo || !tokenAmount) return null
    const [whole = '0', frac = ''] = tokenAmount.split('.')
    const fracPadded = frac.padEnd(6, '0').slice(0, 6)
    let tokenRaw: BN
    try { tokenRaw = new BN(whole).mul(new BN(1_000_000)).add(new BN(fracPadded)) } catch { return null }
    if (tokenRaw.isZero() || tokenRaw.gte(tokenInfo.virtualTokenReserves)) return null
    const sol = tokenInfo.virtualSolReserves
      .mul(tokenRaw)
      .div(tokenInfo.virtualTokenReserves.sub(tokenRaw))
    return lamportsBNToSolDisplay(sol)
  })()

  const priceImpact = (() => {
    if (!tokenInfo || !amountInSol) return 0
    let lamports: BN
    try { lamports = solStringToLamports(amountInSol) } catch { return 0 }
    if (lamports.isZero()) return 0
    const basisPoints = lamports.mul(new BN(10_000)).div(tokenInfo.virtualSolReserves)
    return basisPoints.toNumber() / 100
  })()

  
  function canTrade() {
    if(
      !!tokenInfo &&
      !!selectedWallet &&
      !tokenInfo.complete &&
      (tradeType === 'buy' ? !!amountInSol : !!tokenAmount) &&
      !executingTrade
    ) {
      return true
    } else {
      return false
    }
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
        {executingTrade ? (
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
