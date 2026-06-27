'use client'

import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { TradeType } from './hooks/useTrade'
import { TokenPreview } from '@/lib/types/token-pumpfun'

interface AmountInputProps {
  tradeType:       TradeType
  tokenInfo:       TokenPreview | null
  amountInSol:     string
  tokenAmount:     string
  estimatedOutput: string | null
  estimatedSol:    string | null
  onSolChange:     (v: string) => void
  onTokenChange:   (v: string) => void
  maxTokenAmount?: number | null
}

const SOL_PRESETS   = [0.01, 0.05, 0.1, 0.5, 1]
const TOKEN_PRESETS = [25, 50, 75, 100]

export function AmountInput({
  tradeType, tokenInfo, amountInSol, tokenAmount,
  estimatedOutput, estimatedSol, onSolChange, onTokenChange,
  maxTokenAmount,
}: AmountInputProps) {
  const symbol    = tokenInfo?.symbol ?? 'TOKEN'
  const isBuy     = tradeType === 'buy'
  const exceedsMax = !isBuy && maxTokenAmount != null && !!tokenAmount && parseFloat(tokenAmount) > maxTokenAmount

  function tokenPresetAmount(pct: number): string {
    if (maxTokenAmount == null) return String(pct)
    const amount = maxTokenAmount * pct / 100
    return amount % 1 === 0 ? String(amount) : parseFloat(amount.toFixed(6)).toString()
  }

  return (
    <div className="flex flex-col gap-2.5">

      <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        {isBuy ? 'Amount to Spend' : 'Amount to Sell'}
      </p>

      {/* Preset quick-select buttons */}
      <div className="flex flex-wrap gap-1.5">
        {isBuy
          ? SOL_PRESETS.map(p => (
              <Button
                key={p}
                variant="outline"
                size="xs"
                onClick={() => onSolChange(String(p))}
                className={cn(
                  amountInSol === String(p) &&
                    'border-primary/50 bg-primary/5 text-primary'
                )}
              >
                {p} SOL
              </Button>
            ))
          : TOKEN_PRESETS.map(p => (
              <Button
                key={p}
                variant="outline"
                size="xs"
                onClick={() => onTokenChange(tokenPresetAmount(p))}
              >
                {p}%
              </Button>
            ))}
      </div>

      {/* Amount input with currency badge */}
      <div className="relative flex items-center">
        <Input
          type="number"
          value={isBuy ? amountInSol : tokenAmount}
          onChange={e => isBuy ? onSolChange(e.target.value) : onTokenChange(e.target.value)}
          placeholder={isBuy ? '0.00' : '0'}
          min="0"
          step={isBuy ? '0.001' : undefined}
          className={cn(
            'h-12 pr-24 font-mono text-lg font-semibold',
            '[appearance:textfield]',
            '[&::-webkit-outer-spin-button]:appearance-none',
            '[&::-webkit-inner-spin-button]:appearance-none',
            exceedsMax && 'border-destructive focus-visible:ring-destructive'
          )}
        />
        <div
          className={cn(
            'absolute right-3 flex items-center gap-1 pointer-events-none',
            'rounded-md px-2 py-1 text-xs font-semibold font-mono',
            isBuy
              ? 'bg-primary/10 border border-primary/20 text-primary'
              : 'bg-muted border border-border text-muted-foreground max-w-20 overflow-hidden text-ellipsis whitespace-nowrap'
          )}
        >
          {isBuy ? <><SolIcon /> SOL</> : symbol}
        </div>
      </div>

      {exceedsMax && (
        <p className="flex items-center gap-1.5 text-xs text-destructive">
          <span>⚠</span> Exceeds your holding of {maxTokenAmount!.toLocaleString()} {symbol}
        </p>
      )}

      {/* Estimated receive — buy */}
      {isBuy && estimatedOutput && (
        <div className="flex items-center justify-between rounded-lg bg-emerald-50 border border-emerald-100 px-3.5 py-2.5 animate-in fade-in duration-200">
          <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
            Estimated Receive
          </span>
          <span className="font-mono text-sm font-semibold text-emerald-700">
            ≈ {Number(estimatedOutput).toLocaleString()} {symbol}
          </span>
        </div>
      )}

      {/* Estimated receive — sell */}
      {!isBuy && estimatedSol && (
        <div className="flex items-center justify-between rounded-lg bg-muted/50 border border-border px-3.5 py-2.5 animate-in fade-in duration-200">
          <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
            Estimated Receive
          </span>
          <span className="font-mono text-sm font-semibold text-foreground">
            ≈ {estimatedSol} SOL
          </span>
        </div>
      )}

    </div>
  )
}

function SolIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 128 128" fill="currentColor">
      <path d="M93.3 46.4H11.2c-1.3 0-2-.8-2-1.5v-.1c0-.8.8-1.5 2-1.5h85.1l-3 3.1zm-3-18.1H11.2c-1.3 0-2 .8-2 1.5v.1c0 .8.8 1.5 2 1.5h79.1l-3-3.1zm6 36.3H11.2c-1.3 0-2 .8-2 1.5v.1c0 .8.8 1.5 2 1.5h85.1l-3-3.1z" />
    </svg>
  )
}
