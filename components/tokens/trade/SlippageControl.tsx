'use client'

import { useState } from 'react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

interface SlippageControlProps {
  value:    number
  onChange: (v: number) => void
}

const PRESETS = [0.005, 0.01, 0.02, 0.05]

export function SlippageControl({ value, onChange }: SlippageControlProps) {
  const [custom,    setCustom]    = useState('')
  const [showInput, setShowInput] = useState(false)

  const displayPct   = (value * 100).toFixed(1)
  const warningLevel =
    value >= 0.1  ? 'high' :
    value >= 0.05 ? 'medium' : null

  function handleCustom(raw: string) {
    setCustom(raw)
    const pct = parseFloat(raw)
    if (!isNaN(pct) && pct > 0 && pct <= 50) onChange(pct / 100)
  }

  function handlePreset(p: number) {
    onChange(p)
    setShowInput(false)
    setCustom('')
  }

  return (
    <div className="flex flex-col gap-2.5">

      {/* Header: label + current value */}
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Slippage Tolerance
        </p>
        <span
          className={cn(
            'font-mono text-xs font-semibold transition-colors duration-200',
            warningLevel === 'high'   ? 'text-destructive' :
            warningLevel === 'medium' ? 'text-amber-600'   :
                                        'text-primary'
          )}
        >
          {displayPct}%
          {warningLevel === 'high'   && ' ⚠ High'}
          {warningLevel === 'medium' && ' ⚠ Elevated'}
        </span>
      </div>

      {/* Preset + custom toggle buttons */}
      <div className="flex gap-1.5">
        {PRESETS.map(p => (
          <Button
            key={p}
            variant="outline"
            size="xs"
            onClick={() => handlePreset(p)}
            className={cn(
              'flex-1',
              !showInput && value === p &&
                'border-primary/50 bg-primary/5 text-primary'
            )}
          >
            {(p * 100).toFixed(1)}%
          </Button>
        ))}

        <Button
          variant="outline"
          size="xs"
          onClick={() => setShowInput(s => !s)}
          className={cn(
            'flex-1',
            showInput && 'border-border bg-muted text-foreground'
          )}
        >
          {showInput ? 'Done' : 'Custom'}
        </Button>
      </div>

      {/* Custom % input */}
      {showInput && (
        <div className="relative flex items-center animate-in fade-in slide-in-from-top-1 duration-150">
          <Input
            type="number"
            value={custom}
            onChange={e => handleCustom(e.target.value)}
            placeholder="Enter % e.g. 3"
            min="0.1"
            max="50"
            step="0.1"
            autoFocus
            className={cn(
              'pr-8 font-mono',
              '[appearance:textfield]',
              '[&::-webkit-outer-spin-button]:appearance-none',
              '[&::-webkit-inner-spin-button]:appearance-none'
            )}
          />
          <span className="absolute right-3 text-xs text-muted-foreground pointer-events-none">
            %
          </span>
        </div>
      )}

      {/* Slippage warnings */}
      {warningLevel === 'medium' && (
        <div className="rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-xs text-amber-700 leading-relaxed animate-in fade-in duration-200">
          Elevated slippage tolerance — only use on low-liquidity tokens.
        </div>
      )}

      {warningLevel === 'high' && (
        <div className="rounded-lg bg-destructive/5 border border-destructive/20 px-3 py-2 text-xs text-destructive leading-relaxed animate-in fade-in duration-200">
          ⚠ High slippage may result in significant loss. Front-running risk elevated.
        </div>
      )}

    </div>
  )
}
