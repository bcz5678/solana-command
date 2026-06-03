import { requireSuperAdmin } from "@/lib/auth/require-super-admin"
import { NextRequest, NextResponse } from "next/server";
import { initializeQuickNodeSolana } from '@/app/api/utils/helpers';
import { OnlinePumpSdk } from "@nirholas/pump-sdk";
import BN from 'bn.js';

import { Keypair, PublicKey } from '@solana/web3.js';
import { getWalletKeypairById } from "@/lib/vault/get-wallet-by-id";
import { Executor } from "@/lib/pumpfun/executor";


interface BuyTokenBody {
    walletId:    string
    mintAddress: string
    amountInSol: string   // lamports as decimal string — BN can't cross JSON
    slippage:    number
}

// initialize connection
const quicknodeSolana = initializeQuickNodeSolana();
const onlineSdk = new OnlinePumpSdk(quicknodeSolana.connection);

export async function POST(request: NextRequest) {
    let admin, userId
        try {
            ({ admin, userId } = await requireSuperAdmin())
        } catch (e) {
            return e as Response   // the 401 or 403
        }


    let body: BuyTokenBody

    try{
        body = await request.json();
    } catch {
        return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
    }

    const { walletId, mintAddress, amountInSol: amountInSolRaw, slippage } = body

    const missing = ['walletId', 'mintAddress', 'amountInSol', 'slippage']
        .filter(k => body[k as keyof BuyTokenBody] == null)

    if (missing.length > 0) {
        return NextResponse.json(
        { error: `Missing fields: ${missing.join(', ')}` },
        { status: 400 }
        )
    }

    let amountInSol: BN
    try {
        amountInSol = new BN(amountInSolRaw)
    } catch {
        return NextResponse.json(
            { error: 'amountInSol must be a valid integer string (lamports)' },
            { status: 400 }
        )
    }

    if (amountInSol.lte(new BN(0))) {
        return NextResponse.json(
        { error: 'amountInSol must be greater than 0' },
        { status: 400 }
        )
    }

    if (slippage <= 0 || slippage > 0.5) {
        return NextResponse.json(
        { error: 'slippage must be between 0 and 0.5 (0% — 50%)' },
        { status: 400 }
        )
    }

    const mintAddressPublicKey = new PublicKey(mintAddress);

    // Get Wallet Keypair by the ID

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
        const buySignature = await executor.buy(
            mintAddressPublicKey,
            amountInSol,
            slippage,
        );

        return NextResponse.json({ signature: buySignature }, { status: 200 })
    } catch (err) {
        buyer?.secretKey.fill(0)
        return NextResponse.json(
            { error: `Transaction failed: ${(err as Error).message}` },
            { status: 500 }
        )
    } finally {
        // Zero out the secretKey memory
        buyer.secretKey.fill(0);
    }
}
