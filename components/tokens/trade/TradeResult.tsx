'use client'

import { cn } from '@/lib/utils'
import { TradeResult as TradeResultType, TradeType } from './hooks/useTrade'

interface TradeResultProps {
  result:    TradeResultType
  tradeType: TradeType
  onReset:   () => void
}

export function TradeResult({ result, tradeType, onReset }: TradeResultProps) {
  const isBuy = tradeType === 'buy'

  return (
    <div className="min-h-screen bg-[#080a0f] text-[#c8d4e0] flex flex-col items-center justify-center px-6 py-12 gap-5 animate-in zoom-in-95 fade-in duration-300">

      {/* ── Success icon ─────────────────────────────────────── */}
      <div className="relative size-20 flex items-center justify-center mb-2">
        {/* static base circle */}
        <div
          className={cn(
            'absolute inset-0 rounded-full border-2',
            isBuy
              ? 'bg-[#00ff88]/8  border-[#00ff88]/40'
              : 'bg-[#ff5566]/8  border-[#ff5566]/40'
          )}
        />
        {/* expanding ping ring */}
        <div
          className={cn(
            'absolute inset-0 rounded-full border-2 animate-ping',
            isBuy ? 'border-[#00ff88]/30' : 'border-[#ff5566]/30'
          )}
        />
        <span
          className={cn(
            'relative z-10 text-[2rem] font-bold leading-none',
            isBuy ? 'text-[#00ff88]' : 'text-[#ff5566]'
          )}
        >
          ✓
        </span>
      </div>

      {/* ── Title ────────────────────────────────────────────── */}
      <h1 className="m-0 font-mono text-xl font-bold tracking-[0.15em] text-[#e8f0f8] text-center">
        {isBuy ? 'BUY EXECUTED' : 'SELL EXECUTED'}
      </h1>
      <p className="m-0 font-mono text-[0.65rem] tracking-[0.08em] text-[#3a5060] text-center">
        Transaction confirmed on Solana
      </p>

      {/* ── Token badge ──────────────────────────────────────── */}
      <div className="flex items-center gap-2.5 bg-white/4 border border-white/[0.08] rounded-full px-5 py-2">
        <span className="text-sm font-semibold text-[#e8f0f8]">{result.tokenName}</span>
        <span className="font-mono text-[0.65rem] tracking-[0.05em] text-[#00cc70]">
          ${result.tokenSymbol}
        </span>
      </div>

      {/* ── Stats ────────────────────────────────────────────── */}
      <div className="w-full max-w-[400px] flex items-center gap-6 bg-white/[0.03] border border-white/[0.07] rounded-[14px] p-5">
        <div className="flex-1 flex flex-col gap-1.5 text-center">
          <span className="font-mono text-[0.55rem] tracking-[0.12em] text-[#3a5060]">
            {isBuy ? 'SPENT' : 'RECEIVED'}
          </span>
          <span className={cn('font-mono text-[0.9rem] font-bold', isBuy ? 'text-[#ff5566]' : 'text-[#00ff88]')}>
            {result.inputAmountSol} SOL
          </span>
        </div>

        <span className="text-xl text-[#2a3a40] shrink-0">{isBuy ? '→' : '←'}</span>

        <div className="flex-1 flex flex-col gap-1.5 text-center">
          <span className="font-mono text-[0.55rem] tracking-[0.12em] text-[#3a5060]">
            {isBuy ? 'RECEIVED' : 'SOLD'}
          </span>
          <span className={cn('font-mono text-[0.9rem] font-bold', isBuy ? 'text-[#00ff88]' : 'text-[#ff5566]')}>
            {Number(result.expectedTokens).toLocaleString()} {result.tokenSymbol}
          </span>
        </div>
      </div>

      {/* ── Price impact ─────────────────────────────────────── */}
      {result.priceImpactPct && (
        <div className="flex items-center gap-3 bg-white/[0.02] rounded-lg px-4 py-2">
          <span className="font-mono text-[0.58rem] tracking-[0.1em] text-[#3a5060]">
            PRICE IMPACT
          </span>
          <span className="font-mono text-[0.72rem] font-bold text-[#ffc800]">
            {parseFloat(result.priceImpactPct).toFixed(3)}%
          </span>
        </div>
      )}

      {/* ── Transaction signature ────────────────────────────── */}
      <div className="w-full max-w-[400px] flex flex-col items-center gap-1 bg-black/30 rounded-lg px-3 py-3">
        <span className="font-mono text-[0.55rem] tracking-[0.12em] text-[#2a3a40]">
          TRANSACTION
        </span>
        <span className="font-mono text-[0.65rem] text-[#3a5060] text-center break-all">
          {result.signature.slice(0, 16)}…{result.signature.slice(-16)}
        </span>
      </div>

      {/* ── Action links ─────────────────────────────────────── */}
      <div className="w-full max-w-[400px] flex gap-3">
        <a
          href={result.explorerUrl}
          target="_blank"
          rel="noopener noreferrer"
          className={cn(
            'flex-1 flex items-center justify-center gap-1.5 py-3 rounded-[10px]',
            'font-mono text-[0.65rem] font-bold tracking-[0.08em] no-underline',
            'bg-[#00ff88]/8 border border-[#00ff88]/20 text-[#00cc70]',
            'hover:bg-[#00ff88]/14 hover:-translate-y-px transition-all duration-150'
          )}
        >
          ↗ VIEW ON SOLSCAN
        </a>

        {result.pumpUrl && (
          <a
            href={result.pumpUrl}
            target="_blank"
            rel="noopener noreferrer"
            className={cn(
              'flex-1 flex items-center justify-center gap-1.5 py-3 rounded-[10px]',
              'font-mono text-[0.65rem] font-bold tracking-[0.08em] no-underline',
              'bg-white/4 border border-white/10 text-[#6a8090]',
              'hover:bg-white/8 hover:text-[#c8d4e0] hover:-translate-y-px transition-all duration-150'
            )}
          >
            ◎ PUMP.FUN
          </a>
        )}
      </div>

      {/* ── Reset ────────────────────────────────────────────── */}
      <button
        onClick={onReset}
        className="mt-2 bg-transparent border-none cursor-pointer font-mono text-[0.65rem] font-bold tracking-[0.1em] text-[#3a5060] hover:text-[#c8d4e0] transition-colors duration-150 px-4 py-2"
      >
        ← NEW TRADE
      </button>

    </div>
  )
}
