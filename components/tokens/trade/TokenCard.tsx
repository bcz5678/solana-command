'use client'

import { cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { Card, CardHeader, CardContent, CardFooter } from '@/components/ui/card'
import { TokenSnapshot } from '@/lib/types/token-pumpfun'
import { LAMPORTS_PER_SOL, lamportsBNToSolDisplay, lamportsBNToSolNumber } from '@/lib/lamports'

interface TokenCardProps {
  tokenInfo:   TokenSnapshot
  priceImpact: number
}

// 85 SOL in lamports — pump.fun graduation threshold
const GRADUATION_LAMPORTS = LAMPORTS_PER_SOL.muln(85)

export function TokenCard({ tokenInfo, priceImpact }: TokenCardProps) {
  const mintStr       = tokenInfo.mint.toBase58()
  const marketCapSol  = lamportsBNToSolDisplay(tokenInfo.marketCap)
  const realSolSol    = lamportsBNToSolNumber(tokenInfo.realSolReserves).toFixed(2)
  const curveProgress = Math.min(
    tokenInfo.realSolReserves.muln(100).div(GRADUATION_LAMPORTS).toNumber(),
    100
  )

  const impactClass =
    priceImpact < 1 ? 'text-emerald-600' :
    priceImpact < 5 ? 'text-amber-600'   :
                      'text-destructive'

  return (
    <Card className="w-full max-w-[520px] gap-0 mb-5 animate-in fade-in slide-in-from-bottom-2 duration-300">

      {/* ── Token identity ─────────────────────────────────── */}
      <CardHeader className="flex-row items-center gap-3.5 pb-0 border-b-0">
        {tokenInfo.imageUri ? (
          <img
            src={tokenInfo.imageUri}
            alt={tokenInfo.name}
            onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }}
            className="size-11 shrink-0 rounded-lg object-cover"
          />
        ) : (
          <div className="size-11 shrink-0 rounded-lg bg-muted flex items-center justify-center font-mono text-xs font-bold text-muted-foreground">
            {tokenInfo.symbol?.slice(0, 2).toUpperCase()}
          </div>
        )}

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-0.5">
            <span className="text-sm font-semibold text-foreground truncate">
              {tokenInfo.name}
            </span>
            {tokenInfo.complete && (
              <Badge
                variant="outline"
                className="shrink-0 text-[0.6rem] font-semibold tracking-wide bg-amber-50 border-amber-200 text-amber-700 h-auto py-0.5 px-1.5 rounded"
              >
                GRADUATED
              </Badge>
            )}
          </div>
          <span className="font-mono text-xs text-muted-foreground">
            ${tokenInfo.symbol}
          </span>
        </div>

        <a
          href={`https://pump.fun/${mintStr}`}
          target="_blank"
          rel="noopener noreferrer"
          title="View on pump.fun"
          className="shrink-0 text-sm text-muted-foreground hover:text-primary transition-colors duration-150"
        >
          ↗
        </a>
      </CardHeader>

      {/* ── Stats + bonding curve ──────────────────────────── */}
      <CardContent className="flex flex-col gap-4 pt-4">

        <div className="grid grid-cols-2 gap-2">
          {[
            { label: 'Price',         value: tokenInfo.pricePerToken.toExponential(4),             unit: 'SOL' },
            { label: 'Market Cap',    value: marketCapSol,                                          unit: 'SOL' },
            { label: 'Real Reserves', value: realSolSol,                                            unit: 'SOL' },
            { label: 'Price Impact',  value: priceImpact > 0 ? `${priceImpact.toFixed(2)}%` : '—', unit: '',    valueClass: impactClass },
          ].map(({ label, value, unit, valueClass }) => (
            <div key={label} className="rounded-lg bg-muted/50 px-3 py-2.5 flex flex-col gap-1">
              <span className="text-[0.65rem] font-medium uppercase tracking-wider text-muted-foreground">
                {label}
              </span>
              <span className={cn('font-mono text-sm font-semibold text-foreground', valueClass)}>
                {value}
                {unit && (
                  <span className="text-xs font-normal text-muted-foreground"> {unit}</span>
                )}
              </span>
            </div>
          ))}
        </div>

        {/* Bonding curve progress */}
        <div className="flex flex-col gap-1.5">
          <div className="flex justify-between text-[0.65rem] font-medium uppercase tracking-wider text-muted-foreground">
            <span>Bonding Curve</span>
            <span>{curveProgress.toFixed(1)}%</span>
          </div>
          <div className="h-1.5 rounded-full bg-muted overflow-hidden">
            <div
              className="h-full rounded-full bg-primary transition-[width] duration-700 ease-in-out"
              style={{ width: `${curveProgress}%` }}
            />
          </div>
        </div>

      </CardContent>

      {/* ── Mint address ───────────────────────────────────── */}
      <CardFooter className="border-t bg-transparent px-4 py-3 gap-2">
        <span className="text-[0.65rem] font-medium uppercase tracking-wider text-muted-foreground/60 shrink-0">
          Mint
        </span>
        <span className="font-mono text-xs text-muted-foreground">
          {mintStr.slice(0, 8)}…{mintStr.slice(-8)}
        </span>
      </CardFooter>

    </Card>
  )
}
