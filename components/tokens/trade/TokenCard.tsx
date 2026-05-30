'use client'

import { cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import {
  Card,
  CardHeader,
  CardContent,
  CardFooter,
} from '@/components/ui/card'
import { TokenInfo } from './hooks/useTokenInfo'

interface TokenCardProps {
  tokenInfo:   TokenInfo
  priceImpact: number
}

export function TokenCard({ tokenInfo, priceImpact }: TokenCardProps) {
  const marketCapSol = tokenInfo.virtual_sol_reserves / 1_000_000_000
  const priceInSol   = tokenInfo.price_in_sol ?? (
    tokenInfo.virtual_sol_reserves / tokenInfo.virtual_token_reserves
  )
  const curveProgress = Math.min(
    (tokenInfo.real_sol_reserves / 85_000_000_000) * 100,
    100
  )

  const impactColor =
    priceImpact < 1 ? 'text-[#00ff88]' :
    priceImpact < 5 ? 'text-[#ffc800]' :
                      'text-[#ff5566]'

  return (
    <Card className="w-full max-w-[520px] gap-0 rounded-[14px] bg-white/[0.03] ring-white/[0.08] mb-5 animate-in fade-in slide-in-from-bottom-2 duration-300">

      {/* ── Token identity ─────────────────────────────── */}
      <CardHeader className="flex-row items-center gap-3.5 border-b-0 pb-0">
        {tokenInfo.image ? (
          <img
            src={tokenInfo.image}
            alt={tokenInfo.name}
            onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }}
            className="size-11 shrink-0 rounded-[10px] object-cover"
          />
        ) : (
          <div className="size-11 shrink-0 rounded-[10px] bg-gradient-to-br from-[#0a2a1a] to-[#0a1a2a] border border-[#00ff88]/20 flex items-center justify-center font-mono text-xs font-bold text-[#00cc70]">
            {tokenInfo.symbol?.slice(0, 2).toUpperCase()}
          </div>
        )}

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-0.5">
            <span className="text-sm font-bold text-[#e8f0f8] truncate">
              {tokenInfo.name}
            </span>
            {tokenInfo.complete && (
              <Badge
                variant="outline"
                className="shrink-0 font-mono text-[0.55rem] font-bold tracking-[0.1em] bg-[#ffc800]/15 border-[#ffc800]/30 text-[#ffc800] h-auto py-0.5 px-1.5 rounded"
              >
                GRADUATED
              </Badge>
            )}
          </div>
          <div className="font-mono text-[0.7rem] tracking-[0.08em] text-[#3a6050]">
            ${tokenInfo.symbol}
          </div>
        </div>

        <a
          href={`https://pump.fun/${tokenInfo.mint}`}
          target="_blank"
          rel="noopener noreferrer"
          title="View on pump.fun"
          className="shrink-0 text-base leading-none text-[#2a4050] hover:text-[#00ff88] transition-colors duration-150"
        >
          ↗
        </a>
      </CardHeader>

      {/* ── Stats grid + bonding curve ──────────────────── */}
      <CardContent className="flex flex-col gap-4 pt-4">

        <div className="grid grid-cols-2 gap-3">
          {[
            {
              label: 'PRICE',
              value: priceInSol.toExponential(4),
              unit:  ' SOL',
            },
            {
              label: 'MARKET CAP',
              value: marketCapSol.toFixed(1),
              unit:  ' SOL',
            },
            {
              label: 'REAL RESERVES',
              value: (tokenInfo.real_sol_reserves / 1_000_000_000).toFixed(2),
              unit:  ' SOL',
            },
            {
              label:      'PRICE IMPACT',
              value:      priceImpact > 0 ? `${priceImpact.toFixed(2)}%` : '—',
              unit:       '',
              valueClass: impactColor,
            },
          ].map(({ label, value, unit, valueClass }) => (
            <div
              key={label}
              className="rounded-lg bg-black/20 px-3 py-2.5 flex flex-col gap-1"
            >
              <span className="font-mono text-[0.55rem] tracking-[0.12em] text-[#3a5060]">
                {label}
              </span>
              <span className={cn('font-mono text-[0.78rem] font-bold text-[#c8d4e0]', valueClass)}>
                {value}
                {unit && (
                  <span className="text-[0.6rem] font-normal text-[#3a5060]">{unit}</span>
                )}
              </span>
            </div>
          ))}
        </div>

        {/* Bonding curve progress */}
        <div className="flex flex-col gap-1.5">
          <div className="flex justify-between font-mono text-[0.55rem] tracking-[0.1em] text-[#3a5060]">
            <span>BONDING CURVE</span>
            <span>{curveProgress.toFixed(1)}%</span>
          </div>
          <div className="h-1 rounded-full bg-white/5 overflow-hidden">
            <div
              className="h-full rounded-full bg-gradient-to-r from-[#00cc70] to-[#00ff88] shadow-[0_0_8px_rgba(0,255,136,0.4)] transition-[width] duration-700 ease-in-out"
              style={{ width: `${curveProgress}%` }}
            />
          </div>
        </div>

      </CardContent>

      {/* ── Mint address ───────────────────────────────── */}
      <CardFooter className="border-t border-white/5 bg-transparent px-4 py-3 gap-2.5">
        <span className="font-mono text-[0.55rem] tracking-[0.12em] text-[#2a3a40] shrink-0">
          MINT
        </span>
        <span className="font-mono text-[0.65rem] text-[#3a5060]">
          {tokenInfo.mint.slice(0, 8)}…{tokenInfo.mint.slice(-8)}
        </span>
      </CardFooter>

    </Card>
  )
}
