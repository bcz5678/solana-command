'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import BN from 'bn.js'
import { cn }                           from '@/lib/utils'
import { Label }                        from '@/components/ui/label'
import { TokenPreview } from '@/lib/types/token-pumpfun'
import { TokenMintInput }               from '@/components/trade/strategy-trade/TokenMintInput'
import { PublicKey } from '@solana/web3.js'
import { solStringToLamports, lamportsBNToSolDisplay, lamportsStringToBN } from '@/lib/lamports'
import { TradeType }                    from './hooks/useTrade'
import { useRelayEvent }                from '@/hooks/use-relay-event'
import { TokenCard }                    from './TokenCard'
import { GenericTokenCard }             from './GenericTokenCard'
import { WalletSelector }               from './WalletSelector'
import { AmountInput }                  from './AmountInput'
import { SlippageControl }              from './SlippageControl'
import { WalletRecord }                 from '@/lib/types/wallet'

// Human-typed token amount (e.g. "1.5") → raw on-chain units for an arbitrary decimals count.
function tokenAmountToRawBN(amount: string, decimals: number): BN {
  const [whole = '0', frac = ''] = amount.split('.')
  const fracPadded = frac.padEnd(decimals, '0').slice(0, decimals)
  return new BN(whole).mul(new BN(10).pow(new BN(decimals))).add(new BN(fracPadded || '0'))
}

// Raw on-chain units → human display string (2 fractional digits), for an arbitrary decimals count.
function rawUnitsToDisplay(raw: BN, decimals: number): string {
  const unit = new BN(10).pow(new BN(decimals))
  const whole = raw.div(unit).toString()
  const frac  = raw.mod(unit).toString().padStart(decimals, '0').slice(0, 2)
  return `${whole}.${frac}`
}

export function TokenTradePanel() {
  const [tradeType,      setTradeType]      = useState<TradeType>('buy')
  const [mintAddress,    setMintAddress]    = useState('')
  const [selectedWallet, setSelectedWallet] = useState<WalletRecord | null>(null)
  const [amountInSol,    setAmountInSol]    = useState('')
  const [tokenAmount,    setTokenAmount]    = useState('')
  const [slippage,       setSlippage]       = useState(0.01)

  const [tokenLoading, setTokenLoading]  = useState(false);
  const [tokenError, setTokenError] = useState('');
  const [tokenInfo, setTokenInfo] = useState<TokenPreview | null>(null);
  
  const [wallets, setWallets] = useState<WalletRecord[]>([]);
  const [walletsLoading, setWalletsLoading ] = useState<boolean>(false);

  const [tokenHolding,   setTokenHolding]   = useState<number | null>(null)
  const [holdingLoading, setHoldingLoading] = useState(false)
  const [holdingError,   setHoldingError]   = useState('')

  const debounceRef        = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastHoldingMintRef = useRef('')

  const [tradeError, setTradeError] = useState('');
  const [executingTrade, setExecutingTrade] = useState(false);

  useEffect(() => {
    setWalletsLoading(true)
    getWalletsList()
      .then(result => { if (result) setWallets(result) })
      .finally(() => setWalletsLoading(false))
  }, [])

  // Stable identities — otherwise the debounce effect below (which lists
  // these as deps) re-fires its 1000ms timer on every render, turning a
  // one-shot fetch into a perpetual RPC poll.
  const fetchToken = useCallback(async (mint: string): Promise<void> => {
    setTokenLoading(true)
    try {
      const res = await fetch(`/api/pumpfun/token-info?mintAddress=${encodeURIComponent(mint)}`)
      if (!res.ok) throw new Error('Token not found')
      const { body: { preview: raw } } = await res.json()

      // BN fields arrive as hex strings (BN.toJSON → hex).
      // PublicKey fields arrive as base58 strings (PublicKey.toJSON → toBase58).
      // `curve` is only present for an active (non-graduated) pump.fun bonding curve.
      const preview: TokenPreview = {
        ...raw,
        mint:         new PublicKey(raw.mint),
        marketCapSol: raw.marketCapSol != null ? new BN(raw.marketCapSol, 16) : null,
        curve: raw.curve ? {
          bondingCurve:           new PublicKey(raw.curve.bondingCurve),
          associatedBondingCurve: new PublicKey(raw.curve.associatedBondingCurve),
          virtualSolReserves:     new BN(raw.curve.virtualSolReserves,   16),
          virtualTokenReserves:   new BN(raw.curve.virtualTokenReserves, 16),
          realSolReserves:        new BN(raw.curve.realSolReserves,      16),
          realTokenReserves:      new BN(raw.curve.realTokenReserves,    16),
          totalSupply:            new BN(raw.curve.totalSupply,          16),
        } : null,
      }

      setTokenInfo(preview)
    } catch (error) {
      setTokenError(error instanceof Error ? error.message : 'Failed to load token')
    } finally {
      setTokenLoading(false)
    }
  }, [])

  const clearToken = useCallback(() => {
    setTokenInfo(null)
    setTokenError('')
    setTokenHolding(null)
    setHoldingError('')
    lastHoldingMintRef.current = ''
  }, [])

    // Debounce mint address input — fetch token after 1000ms pause
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)

    if (mintAddress.length >= 32) {
      debounceRef.current = setTimeout(() => {
        fetchToken(mintAddress)
        if (tradeType === 'sell' && selectedWallet && mintAddress !== lastHoldingMintRef.current) {
          lastHoldingMintRef.current = mintAddress
          fetchHolding(selectedWallet.public_key, mintAddress)
        }
      }, 1000)
    } else {
      clearToken()
    }

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [mintAddress, fetchToken, clearToken])

  // Live updates: watch the resolved mint on the relay (lib/wss) instead of
  // polling RPC on a timer. Re-watches on mint change; unwatches on change/unmount.
  const liveRefetchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (!mintAddress) return

    const mint = mintAddress
    fetch('/api/wss/tokens/watch', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ mint }),
    }).catch(() => {})


    return () => {
      if (liveRefetchDebounceRef.current) clearTimeout(liveRefetchDebounceRef.current)
      fetch('/api/wss/tokens/unwatch', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ mint }),
      }).catch(() => {})
    }
  }, [mintAddress])

  // Coalesce bursts of fills into one re-fetch — we only need the latest
  // bonding-curve state, not a patch per trade.
  useRelayEvent('token-transaction', (e) => {
    if (e.mint !== mintAddress) return

       console.log(`TokenTradePanel -> liveRefetchDebounceRef.current : ${liveRefetchDebounceRef.current}`);

       
    if (liveRefetchDebounceRef.current) clearTimeout(liveRefetchDebounceRef.current)
    liveRefetchDebounceRef.current = setTimeout(() => fetchToken(mintAddress), 600)
  })

  // Bonding-curve estimates are pure client-side math against cached reserves —
  // no network call needed per keystroke. Generic (Jupiter-routed) tokens have no
  // such cache, so price/output has to be re-quoted per amount change instead.
  const [genericQuote, setGenericQuote] = useState<{ outAmount: string; priceImpactPct: number | null } | null>(null)
  const quoteDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (quoteDebounceRef.current) clearTimeout(quoteDebounceRef.current)

    if (!tokenInfo || tokenInfo.curve) {
      setGenericQuote(null)
      return
    }

    const amountStr = tradeType === 'buy' ? amountInSol : tokenAmount
    if (!amountStr) {
      setGenericQuote(null)
      return
    }

    quoteDebounceRef.current = setTimeout(async () => {
      try {
        const amountBN = tradeType === 'buy'
          ? solStringToLamports(amountStr)
          : tokenAmountToRawBN(amountStr, tokenInfo.decimals)
        if (amountBN.isZero()) { setGenericQuote(null); return }

        const res = await fetch(
          `/api/pumpfun/quote?mintAddress=${encodeURIComponent(mintAddress)}&side=${tradeType}&amount=${amountBN.toString()}`
        )
        if (!res.ok) { setGenericQuote(null); return }
        setGenericQuote(await res.json())
      } catch {
        setGenericQuote(null)
      }
    }, 400)

    return () => { if (quoteDebounceRef.current) clearTimeout(quoteDebounceRef.current) }
  }, [tokenInfo, tradeType, amountInSol, tokenAmount, mintAddress])

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

  useEffect(() => {
    if (tradeType === 'buy') {
      setTokenHolding(null)
      setHoldingError('')
    } else if (selectedWallet && mintAddress.length >= 32) {
      fetchHolding(selectedWallet.public_key, mintAddress)
    }
  }, [tradeType]) // eslint-disable-line react-hooks/exhaustive-deps

  function reset () {
    setTradeError('');
  }

  async function fetchHolding(walletPublicKey: string, mint: string) {
    setHoldingLoading(true)
    setHoldingError('')
    setTokenHolding(null)
    try {
      const res = await fetch(
        `/api/pumpfun/wallet-holding?walletAddress=${encodeURIComponent(walletPublicKey)}&mintAddress=${encodeURIComponent(mint)}`
      )
      if (!res.ok) throw new Error()
      const { balance } = await res.json()
      setTokenHolding(balance)
      if (balance === 0) setHoldingError('This wallet holds none of this token')
    } catch {
      setHoldingError('Failed to check token holdings')
    } finally {
      setHoldingLoading(false)
    }
  }

  function handleTokenChange(mint: string, resolved: boolean) {
    setMintAddress(resolved ? mint : '')
    reset()
  }

  function handleWalletSelect(wallet: WalletRecord) {
    setSelectedWallet(wallet)
    if (tradeType === 'sell' && mintAddress.length >= 32) {
      fetchHolding(wallet.public_key, mintAddress)
    }
  }

  async function handleTrade() {
    console.log(`button test - selectedWallet: ${selectedWallet?.id}`);
    console.log(`button test - tokenInfo: ${tokenInfo}`);

    if (!selectedWallet || !tokenInfo) return


    try {
      if(tradeType == 'buy') {
        let lamports: BN
        try { lamports = solStringToLamports(amountInSol) } catch { return }
        if (lamports.isZero()) return

        setExecutingTrade(true)
        setTradeError('')

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

        // trade succeeded
      } else {

        // tokenAmount is human-readable (e.g. "1500000" = 1.5M tokens) — convert to raw units.
        let tokens: BN
        try { tokens = tokenAmountToRawBN(tokenAmount, tokenInfo.decimals) } catch { return }
        if (tokens.isZero()) return

          setExecutingTrade(true)
          setTradeError('')

          // Auto-retry loop: the route caps each call to MAX_CHUNKS_PER_CALL
          // transactions to avoid timeouts. We keep calling until tokensRemaining = 0.
          let remaining = tokens
          let lastSignature = ''
          let batch = 0

          while (remaining.gtn(0)) {
            batch++
            console.log(`[sell] batch ${batch} — sending ${remaining.toString()} raw tokens`)

            const res = await fetch('/api/pumpfun/sell', {
              method:  'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                walletId:    selectedWallet.id,
                mintAddress,
                tokenAmount: remaining.toString(),
                slippage,
              }),
            })

            console.log(`[sell] batch ${batch} response status:`, res.status)
            const data = await res.json()
            console.log(`[sell] batch ${batch} response body:`, data)

            if (!res.ok || !data.success) {
              setTradeError(data.error ?? 'Sell failed')
              return
            }

            lastSignature = data.signature ?? lastSignature
            remaining = data.tokensRemaining ? new BN(data.tokensRemaining) : new BN(0)
            console.log(`[sell] batch ${batch} complete — signature: ${lastSignature} — remaining: ${remaining.toString()}`)
          }

          // trade fully complete
          console.log('[sell] fully sold — last signature:', lastSignature)
      }
    } catch(error) {
      setTradeError(`${error}error — please try again`)
    } finally {
      setExecutingTrade(false)
    }
  }



  // Bonding-curve case: pure client-side constant-product math against cached reserves.
  // Generic case: read the debounced Jupiter quote fetched above.
  const estimatedOutput = (() => {
    if (!tokenInfo || !amountInSol) return null

    if (tokenInfo.curve) {
      let lamports: BN
      try { lamports = solStringToLamports(amountInSol) } catch { return null }
      if (lamports.isZero()) return null
      const out = tokenInfo.curve.virtualTokenReserves
        .mul(lamports)
        .div(tokenInfo.curve.virtualSolReserves.add(lamports))
      return rawUnitsToDisplay(out, tokenInfo.decimals)
    }

    if (!genericQuote) return null
    return rawUnitsToDisplay(new BN(genericQuote.outAmount), tokenInfo.decimals)
  })()

  const estimatedSol = (() => {
    if (!tokenInfo || !tokenAmount) return null

    if (tokenInfo.curve) {
      let tokenRaw: BN
      try { tokenRaw = tokenAmountToRawBN(tokenAmount, tokenInfo.decimals) } catch { return null }
      if (tokenRaw.isZero() || tokenRaw.gte(tokenInfo.curve.virtualTokenReserves)) return null
      const sol = tokenInfo.curve.virtualSolReserves
        .mul(tokenRaw)
        .div(tokenInfo.curve.virtualTokenReserves.sub(tokenRaw))
      return lamportsBNToSolDisplay(sol)
    }

    if (!genericQuote) return null
    return lamportsBNToSolDisplay(new BN(genericQuote.outAmount))
  })()

  const priceImpact = (() => {
    if (!tokenInfo) return 0

    if (tokenInfo.curve) {
      if (!amountInSol) return 0
      let lamports: BN
      try { lamports = solStringToLamports(amountInSol) } catch { return 0 }
      if (lamports.isZero()) return 0
      const basisPoints = lamports.mul(new BN(10_000)).div(tokenInfo.curve.virtualSolReserves)
      return basisPoints.toNumber() / 100
    }

    return genericQuote?.priceImpactPct ?? tokenInfo.priceImpactPct ?? 0
  })()

  
  function canTrade() {
    if (!tokenInfo || !selectedWallet || executingTrade) return false
    if (tradeType === 'buy') return !!amountInSol
    if (!tokenHolding || tokenHolding === 0) return false
    if (!tokenAmount) return false
    const amount = parseFloat(tokenAmount)
    return !isNaN(amount) && amount > 0 && amount <= tokenHolding
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

      {/* ── Token ─────────────────────────────────────────── */}
      <div className="flex flex-col gap-1.5">
        <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Token
        </Label>
        <TokenMintInput onTokenChange={handleTokenChange} />
        {tokenError && (
          <p className="flex items-center gap-1.5 text-xs text-destructive">
            <span>⚠</span> {tokenError}
          </p>
        )}
      </div>

      {/* ── Token Card ─────────────────────────────────────── */}
      {tokenLoading && !tokenInfo && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span className="size-3.5 rounded-full border-2 border-border border-t-primary animate-spin" />
          Loading token…
        </div>
      )}
      {tokenInfo && (tokenInfo.curve
        ? <TokenCard tokenInfo={{ ...tokenInfo, curve: tokenInfo.curve }} priceImpact={priceImpact} />
        : <GenericTokenCard tokenInfo={tokenInfo} priceImpact={priceImpact} />
      )}

      {/* ── Graduated Warning ──────────────────────────────── */}
      {tokenInfo?.complete && (
        <div className="flex items-start gap-3 rounded-lg bg-amber-50 border border-amber-200 p-4">
          <span className="text-xl leading-none shrink-0">🎓</span>
          <div>
            <strong className="block text-sm font-semibold text-amber-800 mb-0.5">
              Token Graduated
            </strong>
            <p className="m-0 text-xs text-amber-700 leading-relaxed">
              This token has graduated off the bonding curve. Trades will be routed automatically via Jupiter.
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
          loading={walletsLoading || holdingLoading}
          selected={selectedWallet}
          tradeType={tradeType}
          onSelect={handleWalletSelect}
        />
        {tradeType === 'sell' && holdingError && (
          <p className="flex items-center gap-1.5 text-xs text-destructive">
            <span>⚠</span> {holdingError}
          </p>
        )}
        {tradeType === 'sell' && tokenHolding != null && tokenHolding > 0 && (
          <p className="text-xs text-muted-foreground">
            Holdings: <span className="font-mono font-semibold text-foreground">
              {tokenHolding.toLocaleString()} {tokenInfo?.symbol ?? 'tokens'}
            </span>
          </p>
        )}
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
        maxTokenAmount={tokenHolding}
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
        disabled={!canTrade()}
        className={cn(
          'w-full py-3 rounded-xl flex items-center justify-center gap-2',
          'text-sm font-semibold transition-all duration-200 cursor-pointer',
          tradeType === 'buy'
            ? 'bg-primary text-primary-foreground shadow-sm hover:enabled:opacity-90'
            : 'bg-red-500 text-primary-foreground shadow-sm hover:enabled:opacity-90',
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
