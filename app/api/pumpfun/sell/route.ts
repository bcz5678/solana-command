import { requireSuperAdmin } from "@/lib/auth/require-super-admin"
import { NextRequest, NextResponse } from "next/server";
import { initializeQuickNodeSolana } from '@/app/api/utils/helpers';
import BN from 'bn.js';

import { Keypair, PublicKey } from '@solana/web3.js';
import { getWalletKeypairById } from "@/lib/vault/get-wallet-by-id";
import { Executor } from "@/lib/pumpfun/executor";
import { SellTokenBody } from "@/lib/types/trades";
import { logTrade } from "@/lib/trades/log";
import { getTradeLogContext, TradeLogContext } from "@/lib/trades/context";
import { lamportsBNToSolNumber } from "@/lib/lamports";


const quicknodeSolana = initializeQuickNodeSolana();

export async function POST(request: NextRequest) {
    console.log('[sell] POST received')
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
    console.log('[sell] body:', { walletId, mintAddress, tokenAmount: tokenAmountRaw, slippage })

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

    console.log('[sell] validation passed — loading wallet keypair')
    let buyer: Keypair | null = null
    let logContext: TradeLogContext
    const mintAddressPublicKey = new PublicKey(mintAddress)
    try {
        [buyer, logContext] = await Promise.all([
            getWalletKeypairById(walletId),
            getTradeLogContext(mintAddressPublicKey, quicknodeSolana.connection),
        ])
        console.log('[sell] keypair loaded OK')
    } catch (err) {
        console.error('[sell] keypair load failed:', (err as Error).message)
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
        console.log('[sell] calling executor.sell — mint:', mintAddress, 'tokens:', tokenAmount.toString())
        const result = await executor.sell(
            mintAddressPublicKey,
            tokenAmount,
            slippage,
        );
        console.log('[sell] executor.sell result:', JSON.stringify({ success: result.success, error: result.error, signature: result.signature, tokensRemaining: result.tokensRemaining.toString() }))

        // ── Log trade ───────────────────────────────────────────
        await logTrade({
            walletId,
            side:         'SELL',
            exchange:     logContext.exchange,
            symbol:       logContext.symbol,
            toAddress:    mintAddress,
            amountSol:    lamportsBNToSolNumber(result.solAmount),
            quantity:     result.tokenAmount.toNumber(),
            price:        result.price,
            txSignature:  result.signature ?? null,
            status:       result.success ? 'confirmed' : 'failed',
            slippageBps:  Math.round(slippage * 10_000),
            priceImpact:  logContext.priceImpactPct,
            errorMessage: result.success ? null : result.error,
        })

        return NextResponse.json(
            {
                success:         result.success,
                signature:       result.signature,
                error:           result.error,
                tokensRemaining: result.tokensRemaining.toString(), // BN → string for JSON
            },
            { status: result.success ? 200 : 500 }
        )
    } catch (err) {
        console.error('[sell] executor threw:', (err as Error).message)
        await logTrade({
            walletId,
            side:         'SELL',
            exchange:     logContext.exchange,
            symbol:       logContext.symbol,
            toAddress:    mintAddress,
            quantity:     tokenAmount.toNumber(),
            status:       'failed',
            slippageBps:  Math.round(slippage * 10_000),
            errorMessage: (err as Error).message,
        })
        return NextResponse.json(
            { error: `Transaction failed: ${(err as Error).message}` },
            { status: 500 }
        )
    } finally {
        buyer.secretKey.fill(0);
    }
}
