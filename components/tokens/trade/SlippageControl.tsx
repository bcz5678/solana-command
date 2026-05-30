'use client'

import { useState } from 'react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

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
        <Label className="font-mono text-[0.6rem] font-bold tracking-[0.18em] text-[#3a5060] uppercase">
          SLIPPAGE TOLERANCE
        </Label>
        <span
          className={cn(
            'font-mono text-[0.68rem] font-bold tracking-wider transition-colors duration-200',
            warningLevel === 'high'   ? 'text-[#ff5566]' :
            warningLevel === 'medium' ? 'text-[#ffc800]' :
                                        'text-[#00cc70]'
          )}
        >
          {displayPct}%
          {warningLevel === 'high'   && ' ⚠ HIGH'}
          {warningLevel === 'medium' && ' ⚠ ELEVATED'}
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
              'flex-1 font-mono text-[0.62rem] font-bold tracking-[0.06em]',
              'border-white/[0.07] bg-white/3 text-[#4a6070]',
              'hover:bg-[#00ff88]/6 hover:border-[#00ff88]/15 hover:text-[#00cc70]',
              !showInput && value === p &&
                'bg-[#00ff88]/10 border-[#00ff88]/25 text-[#00ff88]'
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
            'flex-1 font-mono text-[0.62rem] font-bold tracking-[0.06em]',
            'border-white/[0.07] bg-white/3 text-[#3a5060]',
            'hover:bg-white/6 hover:border-white/15 hover:text-[#c8d4e0]',
            showInput && 'bg-white/6 border-white/15 text-[#c8d4e0]'
          )}
        >
          {showInput ? 'DONE' : 'CUSTOM'}
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
              'h-9 pr-10 rounded-lg',
              'font-mono text-sm font-bold text-[#e8f0f8]',
              'bg-white/4 border-[#00ff88]/20',
              'placeholder:text-[#3a5060] placeholder:font-normal',
              'focus-visible:border-[#00ff88]/30 focus-visible:ring-[#00ff88]/10',
              '[appearance:textfield]',
              '[&::-webkit-outer-spin-button]:appearance-none',
              '[&::-webkit-inner-spin-button]:appearance-none'
            )}
          />
          <span className="absolute right-3.5 font-mono text-[0.75rem] text-[#3a5060] pointer-events-none">
            %
          </span>
        </div>
      )}

      {/* Slippage warnings */}
      {warningLevel === 'medium' && (
        <div className="rounded-[7px] bg-[#ffc800]/6 border border-[#ffc800]/15 px-3 py-2 font-mono text-[0.6rem] tracking-[0.04em] leading-relaxed text-[#cc9900] animate-in fade-in duration-200">
          Elevated slippage tolerance — only use on low-liquidity tokens.
        </div>
      )}

      {warningLevel === 'high' && (
        <div className="rounded-[7px] bg-[#ff5566]/7 border border-[#ff5566]/20 px-3 py-2 font-mono text-[0.6rem] tracking-[0.04em] leading-relaxed text-[#ff8090] animate-in fade-in duration-200">
          ⚠ High slippage may result in significant loss. Front-running risk elevated.
        </div>
      )}

    </div>
  )
}
