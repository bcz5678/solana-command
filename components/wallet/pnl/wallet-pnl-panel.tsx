'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { lamportsStringToBN, lamportsBNToSolDisplay } from '@/lib/lamports'
import { useRelayEvent, useRelayStatus } from '@/hooks/use-relay-event'

const POLL_INTERVAL_MS = 8_000
// How long a row stays highlighted after its total PnL changes — long
// enough to notice, short enough that it reads as "just moved" rather than
// a permanently-tinted row.
const FLASH_DURATION_MS = 2_000

type OpenPositionDetail = {
  mintAddress:      string
  tokenSymbol:      string | null
  tokenName:        string | null
  remainingTokens:  number
  costBasisSol:     number
  priceSol:         number | null
  marketValueSol:   number | null
  unrealizedPnlSol: number | null
}

type WalletPnlRow = {
  walletId:           string
  label:              string | null
  publicKey:          string
  walletType:         string | null
  solBalanceLamports: number
  buyCount:           number
  sellCount:          number
  tradeCount:         number
  solSpent:           number
  solReceived:        number
  realizedPnlSol:     number
  lastTradeAt:        string | null
  unrealizedPnlSol:   number
  hasUnknownPrice:    boolean
  openPositions:      OpenPositionDetail[]
  totalPnlSol:        number
}

function maskPubKey(key: string) {
  return `${key.slice(0, 5)}…${key.slice(-5)}`
}

function fmtSol(n: number, digits = 4) {
  return n.toLocaleString(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits })
}

function fmtUsd(n: number) {
  return n.toLocaleString(undefined, { style: 'currency', currency: 'USD' })
}

function fmtToken(n: number) {
  return n.toLocaleString(undefined, { maximumFractionDigits: 2 })
}

function positionsTooltip(positions: OpenPositionDetail[]): string {
  return positions
    .map((p) => {
      const symbol = p.tokenSymbol ?? `${p.mintAddress.slice(0, 6)}…`
      const price = p.priceSol != null ? `${fmtSol(p.priceSol, 8)} SOL/token` : 'price unavailable'
      const pnl = p.unrealizedPnlSol != null ? `${p.unrealizedPnlSol >= 0 ? '+' : ''}${fmtSol(p.unrealizedPnlSol)} SOL` : 'unknown'
      return `${symbol}: ${fmtToken(p.remainingTokens)} tokens @ ${price} → ${pnl}`
    })
    .join('\n')
}

export default function WalletPnlPanel() {
  const [rows, setRows]               = useState<WalletPnlRow[]>([])
  const [solUsdPrice, setSolUsdPrice] = useState<number | null>(null)
  const [fetchedAt, setFetchedAt]     = useState<string | null>(null)
  const [isLoading, setIsLoading]     = useState(true)
  const [error, setError]             = useState<string | null>(null)

  // The panel is computed purely from trade_logs (BUY/SELL) — it has no idea
  // about wallet-to-wallet token transfers, so old muddied history can make
  // it report a loss that never happened. baselineSince is the manual "only
  // count PnL from here on" line the user can draw; null means full history.
  const [baselineSince, setBaselineSince]     = useState<string | null>(null)
  const [baselineBusy, setBaselineBusy]       = useState(false)
  const [showCustomStart, setShowCustomStart] = useState(false)
  const [customStartInput, setCustomStartInput] = useState('')

  // walletId -> { value, expiresAt } — drives the brief flash highlight when
  // a wallet's total PnL changes between polls. Keyed off the poll's OWN
  // numbers (not livePriceByMint below) — a live price can tick several
  // times a second, and flashing on every micro-move would be noise, not
  // signal. This only fires on something structural: a trade landed, a
  // position opened/closed, or the server's own price snapshot moved.
  const [flashes, setFlashes] = useState<Record<string, 'up' | 'down'>>({})
  const prevPnlRef = useRef<Record<string, number>>({})
  const flashTimersRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({})

  // mintAddress -> latest priceSol pushed over the relay's SSE bridge. This
  // is what makes Unrealized/Total PnL update the INSTANT a watched mint's
  // price moves, instead of waiting for the next 8s /api/wallet/pnl poll —
  // the poll still owns realized PnL, positions, and balances (those only
  // change when a trade lands), but price itself is now push-driven.
  const [livePriceByMint, setLivePriceByMint] = useState<Record<string, number | null>>({})
  const watchedMintsRef = useRef<Set<string>>(new Set())
  const relayStatus = useRelayStatus()

  useRelayEvent('token-state', (msg) => {
    setLivePriceByMint((prev) => (prev[msg.mint] === msg.priceSol ? prev : { ...prev, [msg.mint]: msg.priceSol }))
  })

  async function refresh() {
    try {
      const res = await fetch('/api/wallet/pnl')
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      const nextRows: WalletPnlRow[] = data.wallets ?? []

      const prev = prevPnlRef.current
      const nextFlashes: Record<string, 'up' | 'down'> = {}
      for (const row of nextRows) {
        const prevValue = prev[row.walletId]
        if (prevValue !== undefined && prevValue !== row.totalPnlSol) {
          nextFlashes[row.walletId] = row.totalPnlSol > prevValue ? 'up' : 'down'
        }
      }
      prevPnlRef.current = Object.fromEntries(nextRows.map((r) => [r.walletId, r.totalPnlSol]))

      if (Object.keys(nextFlashes).length > 0) {
        setFlashes((cur) => ({ ...cur, ...nextFlashes }))
        for (const walletId of Object.keys(nextFlashes)) {
          clearTimeout(flashTimersRef.current[walletId])
          flashTimersRef.current[walletId] = setTimeout(() => {
            setFlashes((cur) => {
              const { [walletId]: _drop, ...rest } = cur
              return rest
            })
          }, FLASH_DURATION_MS)
        }
      }

      setRows(nextRows)
      setFetchedAt(data.fetchedAt ?? new Date().toISOString())
      setBaselineSince(data.baselineSince ?? null)
      setError(null)
    } catch (err) {
      console.error('[wallet-pnl-panel] refresh failed:', err)
      setError('Failed to load wallet PnL')
    } finally {
      setIsLoading(false)
    }
  }

  async function resetBaseline(since?: string) {
    setBaselineBusy(true)
    try {
      const res = await fetch('/api/wallet/pnl/baseline', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(since ? { since } : {}),
      })
      if (!res.ok) {
        const result = await res.json().catch(() => ({}))
        throw new Error(result.error ?? `HTTP ${res.status}`)
      }
      setShowCustomStart(false)
      setCustomStartInput('')
      await refresh()
    } catch (err) {
      console.error('[wallet-pnl-panel] resetBaseline failed:', err)
      setError(err instanceof Error ? err.message : 'Failed to reset PnL')
    } finally {
      setBaselineBusy(false)
    }
  }

  async function clearBaseline() {
    setBaselineBusy(true)
    try {
      const res = await fetch('/api/wallet/pnl/baseline', { method: 'DELETE' })
      if (!res.ok) {
        const result = await res.json().catch(() => ({}))
        throw new Error(result.error ?? `HTTP ${res.status}`)
      }
      await refresh()
    } catch (err) {
      console.error('[wallet-pnl-panel] clearBaseline failed:', err)
      setError(err instanceof Error ? err.message : 'Failed to clear PnL start point')
    } finally {
      setBaselineBusy(false)
    }
  }

  useEffect(() => {
    refresh()
    const interval = setInterval(refresh, POLL_INTERVAL_MS)

    fetch('/api/price/sol-usd')
      .then((r) => r.json())
      .then(({ solUsd }) => setSolUsdPrice(typeof solUsd === 'number' ? solUsd : null))
      .catch(() => setSolUsdPrice(null))

    return () => {
      clearInterval(interval)
      for (const timer of Object.values(flashTimersRef.current)) clearTimeout(timer)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Whenever a poll surfaces a mint we haven't watched yet, ask the relay to
  // start watching it — this is what makes token-state pushes start arriving
  // for it at all. Idempotent server-side (watchMint on an already-watched
  // mint is a no-op), so re-running this on every poll is cheap; the ref
  // just avoids firing the request again for mints already confirmed watched.
  useEffect(() => {
    const mints = new Set<string>()
    for (const r of rows) for (const p of r.openPositions) mints.add(p.mintAddress)
    const toWatch = [...mints].filter((m) => !watchedMintsRef.current.has(m))
    if (toWatch.length === 0) return
    for (const m of toWatch) watchedMintsRef.current.add(m)
    for (const mint of toWatch) {
      fetch('/api/wss/tokens/watch', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ mint }),
      }).catch((err) => console.warn(`[wallet-pnl-panel] watchMint failed for ${mint}:`, err))
    }
  }, [rows])

  // Re-prices every open position with the freshest number available — a
  // live push if one has arrived for that mint, falling back to the price
  // the last poll itself resolved. Wallet-level Unrealized/Total PnL are
  // recomputed from these, so the numbers on screen move the instant a
  // watched mint's price ticks, not just once every POLL_INTERVAL_MS.
  const liveRows = useMemo(() => rows.map((row) => {
    let unrealizedPnlSol = 0
    let hasUnknownPrice  = false
    const openPositions = row.openPositions.map((p) => {
      const livePrice   = livePriceByMint[p.mintAddress]
      const priceSol    = livePrice !== undefined ? livePrice : p.priceSol
      const marketValueSol   = priceSol != null ? p.remainingTokens * priceSol : null
      const positionUnrealized = marketValueSol != null ? marketValueSol - p.costBasisSol : null
      if (positionUnrealized != null) unrealizedPnlSol += positionUnrealized
      else hasUnknownPrice = true
      return { ...p, priceSol, marketValueSol, unrealizedPnlSol: positionUnrealized }
    })
    return {
      ...row,
      openPositions,
      unrealizedPnlSol,
      hasUnknownPrice,
      totalPnlSol: row.realizedPnlSol + unrealizedPnlSol,
    }
  }), [rows, livePriceByMint])

  const totalRealizedPnlSol   = liveRows.reduce((sum, r) => sum + r.realizedPnlSol, 0)
  const totalUnrealizedPnlSol = liveRows.reduce((sum, r) => sum + r.unrealizedPnlSol, 0)
  const totalPnlSol           = totalRealizedPnlSol + totalUnrealizedPnlSol
  const totalBalanceLamports  = liveRows.reduce((sum, r) => sum + r.solBalanceLamports, 0)
  const anyUnknownPrice       = liveRows.some((r) => r.hasUnknownPrice)

  if (isLoading) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 py-24 text-muted-foreground">
        <span className="size-8 animate-spin rounded-full border-2 border-current border-t-transparent" />
        <p className="text-sm">Loading wallet PnL…</p>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      {error && <p className="text-destructive text-sm">{error}</p>}

      {/* Summary strip */}
      <div className="flex flex-wrap items-center gap-4 rounded-lg border border-border bg-muted/20 px-4 py-3">
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <span className="relative flex size-2">
            <span className={[
              'absolute inline-flex h-full w-full rounded-full opacity-75',
              relayStatus === 'open' ? 'animate-ping bg-green-500' : 'bg-amber-500',
            ].join(' ')} />
            <span className={['relative inline-flex size-2 rounded-full', relayStatus === 'open' ? 'bg-green-500' : 'bg-amber-500'].join(' ')} />
          </span>
          {relayStatus === 'open' ? 'Live prices connected' : relayStatus === 'connecting' ? 'Connecting to live prices…' : 'Live prices disconnected'}
          {' · trades/balances refresh every '}{POLL_INTERVAL_MS / 1000}s
          {fetchedAt && <span className="text-muted-foreground/60">· updated {new Date(fetchedAt).toLocaleTimeString()}</span>}
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-6">
          <div className="flex flex-col items-end">
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Total Balance</span>
            <span className="text-sm font-semibold tabular-nums">{lamportsBNToSolDisplay(lamportsStringToBN(String(totalBalanceLamports)))} SOL</span>
          </div>
          <div className="flex flex-col items-end">
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Realized</span>
            <span className={[
              'text-sm font-semibold tabular-nums',
              totalRealizedPnlSol > 0 ? 'text-green-500' : totalRealizedPnlSol < 0 ? 'text-red-500' : 'text-muted-foreground',
            ].join(' ')}>
              {totalRealizedPnlSol >= 0 ? '+' : ''}{fmtSol(totalRealizedPnlSol)} SOL
            </span>
          </div>
          <div className="flex flex-col items-end">
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Unrealized</span>
            <span className={[
              'text-sm font-semibold tabular-nums',
              totalUnrealizedPnlSol > 0 ? 'text-green-500' : totalUnrealizedPnlSol < 0 ? 'text-red-500' : 'text-muted-foreground',
            ].join(' ')}>
              {totalUnrealizedPnlSol >= 0 ? '+' : ''}{fmtSol(totalUnrealizedPnlSol)} SOL
            </span>
          </div>
          <div className="flex flex-col items-end">
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Total PnL</span>
            <span className={[
              'text-sm font-semibold tabular-nums',
              totalPnlSol > 0 ? 'text-green-500' : totalPnlSol < 0 ? 'text-red-500' : 'text-muted-foreground',
            ].join(' ')}>
              {totalPnlSol >= 0 ? '+' : ''}{fmtSol(totalPnlSol)} SOL
              {solUsdPrice != null && (
                <span className="ml-1.5 font-normal text-muted-foreground">({fmtUsd(totalPnlSol * solUsdPrice)})</span>
              )}
            </span>
          </div>
        </div>
      </div>

      {/* Baseline / reset controls */}
      <div className="flex flex-wrap items-center gap-2 -mt-1">
        <span className="text-xs text-muted-foreground">
          {baselineSince
            ? <>Showing PnL since <span className="font-medium text-foreground">{new Date(baselineSince).toLocaleString()}</span></>
            : 'Showing full history'}
        </span>
        <button
          type="button"
          disabled={baselineBusy}
          onClick={() => resetBaseline()}
          className="rounded-md border border-border px-2 py-0.5 text-[11px] text-muted-foreground hover:border-foreground/30 hover:text-foreground transition-colors disabled:opacity-40"
          title="Only count trades from this moment forward — use this if old history (e.g. tokens moved between wallets) is skewing the numbers above."
        >
          {baselineBusy ? 'Working…' : 'Reset PnL (start from now)'}
        </button>
        <button
          type="button"
          disabled={baselineBusy}
          onClick={() => setShowCustomStart((v) => !v)}
          className="rounded-md border border-border px-2 py-0.5 text-[11px] text-muted-foreground hover:border-foreground/30 hover:text-foreground transition-colors disabled:opacity-40"
        >
          Set start point…
        </button>
        {baselineSince && (
          <button
            type="button"
            disabled={baselineBusy}
            onClick={clearBaseline}
            className="rounded-md border border-border px-2 py-0.5 text-[11px] text-muted-foreground hover:border-foreground/30 hover:text-foreground transition-colors disabled:opacity-40"
          >
            Show full history
          </button>
        )}
        {showCustomStart && (
          <>
            <input
              type="datetime-local"
              value={customStartInput}
              onChange={(e) => setCustomStartInput(e.target.value)}
              className="h-7 rounded-md border border-input bg-transparent px-2 text-[11px] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            />
            <button
              type="button"
              disabled={baselineBusy || !customStartInput}
              onClick={() => resetBaseline(new Date(customStartInput).toISOString())}
              className="rounded-md border border-blue-500/60 bg-blue-500/10 px-2 py-0.5 text-[11px] text-blue-500 hover:bg-blue-500/20 transition-colors disabled:opacity-40"
            >
              Apply
            </button>
          </>
        )}
      </div>

      <p className="text-[11px] text-muted-foreground -mt-2">
        Realized = confirmed SOL received from sells minus confirmed SOL spent on buys. Unrealized marks every
        still-open position (bought, not yet sold) to its current live price via the relay, using average-cost
        basis. This panel doesn&apos;t track wallet-to-wallet token transfers, so a position moved off a wallet
        without selling can misprice that wallet&apos;s Unrealized — use &quot;Reset PnL&quot; above if old history
        is skewing the totals. {anyUnknownPrice && 'Some open positions show "—" — the relay couldn\'t price that mint right now, so they\'re excluded from Unrealized until it can.'}
      </p>

      {/* Table */}
      <div className="w-full overflow-x-auto rounded-md border">
        <table className="w-full text-sm border-collapse">
          <thead className="sticky top-0 z-10 bg-muted">
            <tr className="border-b text-xs font-medium uppercase tracking-wider text-muted-foreground">
              <th className="px-3 py-2.5 text-left">Wallet</th>
              <th className="px-3 py-2.5 text-left">Type</th>
              <th className="px-3 py-2.5 text-right">SOL Balance</th>
              <th className="px-3 py-2.5 text-right">Trades</th>
              <th className="px-3 py-2.5 text-right">Realized</th>
              <th className="px-3 py-2.5 text-right">Open Positions</th>
              <th className="px-3 py-2.5 text-right">Unrealized</th>
              <th className="px-3 py-2.5 text-right">Total PnL</th>
              <th className="px-3 py-2.5 text-right">Last Trade</th>
            </tr>
          </thead>
          <tbody>
            {liveRows.length === 0 && (
              <tr>
                <td colSpan={9} className="px-3 py-6 text-center text-sm text-muted-foreground">
                  No wallets found.
                </td>
              </tr>
            )}
            {liveRows
              .slice()
              .sort((a, b) => b.totalPnlSol - a.totalPnlSol)
              .map((row) => {
                const flash = flashes[row.walletId]
                const realizedPositive   = row.realizedPnlSol > 0
                const realizedNegative   = row.realizedPnlSol < 0
                const unrealizedPositive = row.unrealizedPnlSol > 0
                const unrealizedNegative = row.unrealizedPnlSol < 0
                const totalPositive      = row.totalPnlSol > 0
                const totalNegative      = row.totalPnlSol < 0
                const hasPositions       = row.openPositions.length > 0
                return (
                  <tr
                    key={row.walletId}
                    className={[
                      'border-b transition-colors duration-700',
                      flash === 'up'   ? 'bg-green-500/15' :
                      flash === 'down' ? 'bg-red-500/15'   :
                      'hover:bg-muted/30',
                    ].join(' ')}
                  >
                    <td className="px-3 py-2.5">
                      <div className="flex flex-col">
                        {row.label && <span className="font-medium text-foreground">{row.label}</span>}
                        <span className="font-mono text-xs text-muted-foreground">{maskPubKey(row.publicKey)}</span>
                      </div>
                    </td>
                    <td className="px-3 py-2.5 text-xs text-muted-foreground">{row.walletType ?? '—'}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-xs">
                      {lamportsBNToSolDisplay(lamportsStringToBN(String(row.solBalanceLamports)))}
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-xs text-muted-foreground">
                      {row.tradeCount} <span className="text-muted-foreground/60">({row.buyCount}B/{row.sellCount}S)</span>
                    </td>
                    <td className="px-3 py-2.5 text-right">
                      <span className={[
                        'tabular-nums text-xs font-medium',
                        realizedPositive ? 'text-green-500' : realizedNegative ? 'text-red-500' : 'text-muted-foreground',
                      ].join(' ')}>
                        {row.realizedPnlSol >= 0 ? '+' : ''}{fmtSol(row.realizedPnlSol)}
                      </span>
                    </td>
                    <td
                      className="px-3 py-2.5 text-right tabular-nums text-xs text-muted-foreground"
                      title={hasPositions ? positionsTooltip(row.openPositions) : undefined}
                    >
                      {hasPositions ? `${row.openPositions.length} pos.` : '—'}
                    </td>
                    <td className="px-3 py-2.5 text-right">
                      <span className={[
                        'tabular-nums text-xs font-medium',
                        !hasPositions ? 'text-muted-foreground' :
                        unrealizedPositive ? 'text-green-500' : unrealizedNegative ? 'text-red-500' : 'text-muted-foreground',
                      ].join(' ')}>
                        {hasPositions ? `${row.unrealizedPnlSol >= 0 ? '+' : ''}${fmtSol(row.unrealizedPnlSol)}` : '—'}
                        {row.hasUnknownPrice && <span className="ml-1 text-[10px] text-amber-500">*</span>}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 text-right">
                      <div className="flex flex-col items-end">
                        <span className={[
                          'tabular-nums text-xs font-semibold',
                          totalPositive ? 'text-green-500' : totalNegative ? 'text-red-500' : 'text-muted-foreground',
                        ].join(' ')}>
                          {row.totalPnlSol >= 0 ? '+' : ''}{fmtSol(row.totalPnlSol)} SOL
                        </span>
                        {solUsdPrice != null && row.totalPnlSol !== 0 && (
                          <span className="text-[10px] text-muted-foreground">{fmtUsd(row.totalPnlSol * solUsdPrice)}</span>
                        )}
                      </div>
                    </td>
                    <td className="px-3 py-2.5 text-right text-xs text-muted-foreground whitespace-nowrap">
                      {row.lastTradeAt ? new Date(row.lastTradeAt).toLocaleString() : '—'}
                    </td>
                  </tr>
                )
              })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
