'use client'

// app/trade/page.tsx
// Token buy/sell trading interface

import { Suspense } from 'react'
import { TokenTradePanel } from '@/components/tokens/trade/TokenTradePanel'

export default function TradePage() {
  return (
    <div className="trade-page">
      <Suspense fallback={<TradeSkeleton />}>
        <TokenTradePanel />
      </Suspense>
    </div>
  )
}

function TradeSkeleton() {
  return (
    <div className="skeleton-wrap">
      <div className="skeleton-header" />
      <div className="skeleton-body" />
    </div>
  )
}

