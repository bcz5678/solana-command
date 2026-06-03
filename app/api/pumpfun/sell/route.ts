import { requireSuperAdmin } from "@/lib/auth/require-super-admin"
import { NextRequest, NextResponse } from "next/server";
import { initializeQuickNodeSolana } from '@/app/api/utils/helpers';
import BN from 'bn.js';

import { Keypair, PublicKey } from '@solana/web3.js';
import { getWalletKeypairById } from "@/lib/vault/get-wallet-by-id";
import { Executor } from "@/lib/pumpfun/executor";


interface SellTokenBody {
    walletId: string
    mintAddress: string
    tokenAmount: string
    slippage: number
}

const quicknodeSolana = initializeQuickNodeSolana();

export async function POST(request: NextRequest) {
    try {
        await requireSuperAdmin()
    } catch (e) {
        return e as Response
    }

    let body: SellTokenBody
    try {
        body = await request.json();
    } catch {
        return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
    }

    const { walletId, mintAddress, tokenAmount: tokenAmountRaw, slippage } = body

    const missing = ['walletId', 'mintAddress', 'tokenAmount', 'slippage']
        .filter(k => body[k as keyof SellTokenBody] == null)

    if (missing.length > 0) {
        return NextResponse.json(
            { error: `Missing fields: ${missing.join(', ')}` },
            { status: 400 }
        )
    }

    let tokenAmount: BN
    try {
        tokenAmount = new BN(String(tokenAmountRaw))
    } catch {
        return NextResponse.json({ error: 'Invalid tokenAmount' }, { status: 400 })
    }

    if (tokenAmount.lte(new BN(0))) {
        return NextResponse.json(
            { error: 'tokenAmount must be greater than 0' },
            { status: 400 }
        )
    }

    if (slippage <= 0 || slippage > 0.5) {
        return NextResponse.json(
            { error: 'slippage must be between 0 and 0.5 (0% — 50%)' },
            { status: 400 }
        )
    }

    let buyer: Keypair | null = null
    try {
        buyer = await getWalletKeypairById(walletId)
    } catch (err) {
        return NextResponse.json(
            { error: `Failed to load wallet keypair: ${(err as Error).message}` },
            { status: 500 }
        )
    }

    const executor = new Executor({
        connection: quicknodeSolana.connection,
        wallet: buyer,
        defaultSlippage: 0.05,
        maxRetries: 5,
    });

    try {
        const result = await executor.sell(
            new PublicKey(mintAddress),
            tokenAmount,
            slippage,
        );
        return NextResponse.json(result, { status: 200 })
    } catch (err) {
        return NextResponse.json(
            { error: `Transaction failed: ${(err as Error).message}` },
            { status: 500 }
        )
    } finally {
        buyer.secretKey.fill(0);
    }
}
