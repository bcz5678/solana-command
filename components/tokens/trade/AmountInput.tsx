'use client'

import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { TradeType } from './hooks/useTrade'
import { TokenInfo } from './hooks/useTokenInfo'

interface AmountInputProps {
  tradeType:       TradeType
  tokenInfo:       TokenInfo | null
  amountInSol:     string
  tokenAmount:     string
  estimatedOutput: string | null
  estimatedSol:    string | null
  onSolChange:     (v: string) => void
  onTokenChange:   (v: string) => void
}

const SOL_PRESETS   = [0.01, 0.05, 0.1, 0.5, 1]
const TOKEN_PRESETS = [25, 50, 75, 100]

export function AmountInput({
  tradeType,
  tokenInfo,
  amountInSol,
  tokenAmount,
  estimatedOutput,
  estimatedSol,
  onSolChange,
  onTokenChange,
}: AmountInputProps) {
  const symbol = tokenInfo?.symbol ?? 'TOKEN'
  const isBuy  = tradeType === 'buy'

  return (
    <div className="flex flex-col gap-2.5">

      {/* Section label */}
      <Label className="font-mono text-[0.6rem] font-bold tracking-[0.18em] text-[#3a5060] uppercase">
        {isBuy ? 'AMOUNT TO SPEND' : 'AMOUNT TO SELL'}
      </Label>

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
                  'font-mono text-[0.65rem] font-bold tracking-[0.05em]',
                  'border-white/[0.08] bg-white/[0.04] text-[#4a6070]',
                  'hover:bg-[#00ff88]/[0.08] hover:border-[#00ff88]/20 hover:text-[#00ff88]',
                  amountInSol === String(p) &&
                    'bg-[#00ff88]/[0.12] border-[#00ff88]/30 text-[#00ff88]'
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
                onClick={() => onTokenChange(String(p))}
                className={cn(
                  'font-mono text-[0.65rem] font-bold tracking-[0.05em]',
                  'border-white/[0.08] bg-white/[0.04] text-[#4a6070]',
                  'hover:bg-[#00ff88]/[0.08] hover:border-[#00ff88]/20 hover:text-[#00ff88]'
                )}
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
            'h-12 pr-24 rounded-[10px]',
            'font-mono text-xl font-bold text-[#e8f0f8]',
            'bg-white/[0.03] border-white/[0.08]',
            'placeholder:text-[#1a2a30] placeholder:font-normal',
            'focus-visible:border-[#00ff88]/30 focus-visible:ring-[#00ff88]/10',
            '[appearance:textfield]',
            '[&::-webkit-outer-spin-button]:appearance-none',
            '[&::-webkit-inner-spin-button]:appearance-none'
          )}
        />

        <div
          className={cn(
            'absolute right-3.5 flex items-center gap-1.5 pointer-events-none',
            'font-mono text-[0.7rem] font-bold tracking-[0.08em] rounded-md px-2.5 py-1',
            isBuy
              ? 'bg-[#9964ff]/15 border border-[#9964ff]/25 text-[#9964ff]'
              : 'bg-[#00ff88]/10 border border-[#00ff88]/20 text-[#00cc70] max-w-[80px] overflow-hidden text-ellipsis whitespace-nowrap'
          )}
        >
          {isBuy ? <><SolIcon /> SOL</> : symbol}
        </div>
      </div>

      {/* Estimated receive — buy */}
      {isBuy && estimatedOutput && (
        <div className="flex items-center justify-between rounded-lg bg-[#00ff88]/[0.04] border border-[#00ff88]/10 px-3.5 py-2.5 animate-in fade-in duration-200">
          <span className="font-mono text-[0.58rem] tracking-[0.1em] text-[#3a5060]">
            ESTIMATED RECEIVE
          </span>
          <span className="font-mono text-[0.78rem] font-bold text-[#00ff88]">
            ≈ {Number(estimatedOutput).toLocaleString()} {symbol}
          </span>
        </div>
      )}

      {/* Estimated receive — sell */}
      {!isBuy && estimatedSol && (
        <div className="flex items-center justify-between rounded-lg bg-[#ff5566]/[0.04] border border-[#ff5566]/10 px-3.5 py-2.5 animate-in fade-in duration-200">
          <span className="font-mono text-[0.58rem] tracking-[0.1em] text-[#3a5060]">
            ESTIMATED RECEIVE
          </span>
          <span className="font-mono text-[0.78rem] font-bold text-[#ff5566]">
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
