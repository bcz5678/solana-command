import { NextResponse } from 'next/server'

export async function GET() {
    try {
        const res = await fetch('https://bundles.jito.wtf/api/v1/bundles/tip_floor', {
            next: { revalidate: 10 },
        })
        if (!res.ok) return NextResponse.json({ error: 'Jito API error' }, { status: 502 })
        const data = await res.json()
        const row = Array.isArray(data) ? data[0] : data

        console.log('jito-tip-floor raw (SOL):', JSON.stringify(row))

        const toL = (sol: number | null | undefined) => Math.round((sol ?? 0) * 1e9)

        return NextResponse.json({
            p25:   toL(row.landed_tips_25th_percentile),
            p50:   toL(row.landed_tips_50th_percentile),
            p75:   toL(row.landed_tips_75th_percentile),
            p95:   toL(row.landed_tips_95th_percentile),
            p99:   toL(row.landed_tips_99th_percentile),
            ema50: toL(row.ema_landed_tips_50th_percentile),
        })
    } catch {
        return NextResponse.json({ error: 'Failed to fetch tip floor' }, { status: 502 })
    }
}
