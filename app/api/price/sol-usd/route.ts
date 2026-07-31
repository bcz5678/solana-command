import { NextResponse } from 'next/server'
import { getSolUsdPrice } from '@/lib/trade/jupiter'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const solUsd = await getSolUsdPrice()
    return NextResponse.json({ solUsd })
  } catch (error) {
    console.error('[price/sol-usd] error:', error)
    return NextResponse.json({ error: 'Failed to fetch SOL/USD price' }, { status: 502 })
  }
}
