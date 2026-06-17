'use client'

import { cn } from '@/lib/utils'
import { Card, CardContent } from '@/components/ui/card'
import { TradeResult as TradeResultType, TradeType } from './hooks/useTrade'

interface TradeResultProps {
  result:    TradeResultType
  tradeType: TradeType
  onReset:   () => void
}

export function TradeResult({ result, tradeType, onReset }: TradeResultProps) {
  const isBuy = tradeType === 'buy'

  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center px-6 py-12 gap-5 animate-in zoom-in-95 fade-in duration-300">

      {/* ── Success icon ─────────────────────────────────────── */}
      <div className="relative size-20 flex items-center justify-center mb-2">
        <div
          className={cn(
            'absolute inset-0 rounded-full border-2',
            isBuy
              ? 'bg-primary/10 border-primary/40'
              : 'bg-destructive/10 border-destructive/40'
          )}
        />
        <div
          className={cn(
            'absolute inset-0 rounded-full border-2 animate-ping',
            isBuy ? 'border-primary/30' : 'border-destructive/30'
          )}
        />
        <span className={cn('relative z-10 text-3xl font-bold leading-none', isBuy ? 'text-primary' : 'text-destructive')}>
          ✓
        </span>
      </div>

      {/* ── Title ────────────────────────────────────────────── */}
      <h1 className="m-0 text-xl font-bold tracking-wide text-foreground text-center">
        {isBuy ? 'Buy Executed' : 'Sell Executed'}
      </h1>
      <p className="m-0 text-sm text-muted-foreground text-center">
        Transaction confirmed on Solana
      </p>

      {/* ── Token badge ──────────────────────────────────────── */}
      <div className="flex items-center gap-2 bg-muted border border-border rounded-full px-5 py-2">
        <span className="text-sm font-semibold text-foreground">{result.tokenName}</span>
        <span className="font-mono text-xs text-muted-foreground">${result.tokenSymbol}</span>
      </div>

      {/* ── Stats ────────────────────────────────────────────── */}
      <Card className="w-full max-w-100">
        <CardContent className="flex items-center gap-6 pt-5 pb-5">
          <div className="flex-1 flex flex-col gap-1 text-center">
            <span className="text-[0.65rem] font-medium uppercase tracking-wider text-muted-foreground">
              {isBuy ? 'Spent' : 'Received'}
            </span>
            <span className={cn('font-mono text-base font-bold', isBuy ? 'text-destructive' : 'text-emerald-600')}>
              {result.inputAmountSol} SOL
            </span>
          </div>

          <span className="text-lg text-muted-foreground/40 shrink-0">{isBuy ? '→' : '←'}</span>

          <div className="flex-1 flex flex-col gap-1 text-center">
            <span className="text-[0.65rem] font-medium uppercase tracking-wider text-muted-foreground">
              {isBuy ? 'Received' : 'Sold'}
            </span>
            <span className={cn('font-mono text-base font-bold', isBuy ? 'text-emerald-600' : 'text-destructive')}>
              {Number(result.expectedTokens).toLocaleString()} {result.tokenSymbol}
            </span>
          </div>
        </CardContent>
      </Card>

      {/* ── Price impact ─────────────────────────────────────── */}
      {result.priceImpactPct && (
        <div className="flex items-center gap-3 bg-amber-50 border border-amber-100 rounded-lg px-4 py-2">
          <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            Price Impact
          </span>
          <span className="font-mono text-sm font-semibold text-amber-700">
            {parseFloat(result.priceImpactPct).toFixed(3)}%
          </span>
        </div>
      )}

      {/* ── Transaction signature ────────────────────────────── */}
      <div className="w-full max-w-100 flex flex-col items-center gap-1 bg-muted rounded-lg px-3 py-3">
        <span className="text-[0.65rem] font-medium uppercase tracking-wider text-muted-foreground/60">
          Transaction
        </span>
        <span className="font-mono text-xs text-muted-foreground text-center break-all">
          {result.signature.slice(0, 16)}…{result.signature.slice(-16)}
        </span>
      </div>

      {/* ── Action links ─────────────────────────────────────── */}
      <div className="w-full max-w-100 flex gap-3">
        <a
          href={result.explorerUrl}
          target="_blank"
          rel="noopener noreferrer"
          className={cn(
            'flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-lg no-underline',
            'text-xs font-semibold',
            'bg-primary/5 border border-primary/20 text-primary',
            'hover:bg-primary/10 hover:-translate-y-px transition-all duration-150'
          )}
        >
          ↗ View on Solscan
        </a>

        {result.pumpUrl && (
          <a
            href={result.pumpUrl}
            target="_blank"
            rel="noopener noreferrer"
            className={cn(
              'flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-lg no-underline',
              'text-xs font-semibold',
              'bg-muted border border-border text-muted-foreground',
              'hover:bg-muted/80 hover:text-foreground hover:-translate-y-px transition-all duration-150'
            )}
          >
            ◎ pump.fun
          </a>
        )}
      </div>

      {/* ── Reset ────────────────────────────────────────────── */}
      <button
        onClick={onReset}
        className="mt-1 bg-transparent border-none cursor-pointer text-xs font-medium text-muted-foreground hover:text-foreground transition-colors duration-150 px-4 py-2"
      >
        ← New Trade
      </button>

    </div>
  )
}
