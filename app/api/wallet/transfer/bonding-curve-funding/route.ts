import { computeBondingCurveFunding } from '@/lib/wallet/bonding-curve-funding';

export const dynamic = 'force-dynamic';

type RequestBody = {
    walletCount:             number
    includeDevCreationCost:  boolean
    jitoTipSol?:             number
    bufferPct?:              number
}

export async function POST(request: Request) {
    let body: RequestBody
    try {
        body = await request.json()
    } catch {
        return new Response(JSON.stringify({ error: 'Invalid JSON body.' }), {
            status: 400,
            headers: { 'Content-Type': 'application/json' },
        })
    }

    const { walletCount, includeDevCreationCost, jitoTipSol, bufferPct } = body
    if (!Number.isInteger(walletCount) || walletCount <= 0) {
        return new Response(JSON.stringify({ error: 'walletCount must be a positive integer.' }), {
            status: 400,
            headers: { 'Content-Type': 'application/json' },
        })
    }

    const wallets = computeBondingCurveFunding({
        walletCount,
        includeDevCreationCost: !!includeDevCreationCost,
        jitoTipSol,
        bufferPct,
    })

    return new Response(JSON.stringify({ wallets }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
    })
}
