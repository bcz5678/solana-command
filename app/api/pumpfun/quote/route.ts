import { NextRequest, NextResponse } from 'next/server';
import BN from 'bn.js';

import { getJupiterQuote, WRAPPED_SOL_MINT } from '@/lib/trade/jupiter';

const DEFAULT_SLIPPAGE_BPS = 500; // 5% — display-only estimate, not used for the real trade's slippage

export async function GET(request: NextRequest) {
    const url = new URL(request.url);
    const mintAddress = url.searchParams.get('mintAddress');
    const side        = url.searchParams.get('side'); // 'buy' | 'sell'
    const amountRaw   = url.searchParams.get('amount');

    if (!mintAddress || !amountRaw || (side !== 'buy' && side !== 'sell')) {
        return NextResponse.json({ error: 'mintAddress, side (buy|sell), and amount are required' }, { status: 400 });
    }

    let amount: BN;
    try {
        amount = new BN(amountRaw);
    } catch {
        return NextResponse.json({ error: 'amount must be an integer string (raw units)' }, { status: 400 });
    }

    if (amount.lte(new BN(0))) {
        return NextResponse.json({ error: 'amount must be greater than 0' }, { status: 400 });
    }

    const [inputMint, outputMint] = side === 'buy'
        ? [WRAPPED_SOL_MINT, mintAddress]
        : [mintAddress, WRAPPED_SOL_MINT];

    try {
        const quote = await getJupiterQuote(inputMint, outputMint, amount, DEFAULT_SLIPPAGE_BPS);
        const priceImpactPct = typeof quote.priceImpactPct === 'string' ? parseFloat(quote.priceImpactPct) : null;

        return NextResponse.json({
            outAmount: quote.outAmount,
            priceImpactPct,
        }, { status: 200 });
    } catch (err) {
        return NextResponse.json(
            { error: err instanceof Error ? err.message : 'Failed to fetch quote' },
            { status: 502 },
        );
    }
}
