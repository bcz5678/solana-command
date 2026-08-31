import { PublicKey } from '@solana/web3.js';
import BN from 'bn.js';
import { initializeConnection, handleError } from '@/app/api/utils/helpers';
import { getWalletKeypairById } from '@/lib/vault/get-wallet-by-id';
import { Executor } from '@/lib/pumpfun/executor';
import { parsePumpError } from '@/lib/pumpfun/errors';
import { logTrade } from '@/lib/trades/log';
import { getTradeLogContext } from '@/lib/trades/context';
import { lamportsBNToSolNumber } from '@/lib/lamports';
import { maybeEnqueueCommentAfterBuy } from '@/lib/pumpfun/comment-scheduler';
import type { AutoCommentOptions } from '@/lib/types/trades';

export const dynamic    = 'force-dynamic';
export const maxDuration = 60;

export async function POST(request: Request) {
    let body: { walletId: string; mintAddress: string; solAmountLamports: string; slippage: number; dryRun?: boolean; autoComment?: AutoCommentOptions }
    try {
        body = await request.json()
    } catch {
        return new Response(JSON.stringify({ error: 'Invalid JSON body.' }), {
            status: 400,
            headers: { 'Content-Type': 'application/json' },
        })
    }

    const { walletId, mintAddress, solAmountLamports, slippage, dryRun, autoComment } = body
    if (!walletId || !mintAddress || !solAmountLamports) {
        return new Response(JSON.stringify({ error: 'walletId, mintAddress, and solAmountLamports are required.' }), {
            status: 400,
            headers: { 'Content-Type': 'application/json' },
        })
    }

    let keypair = null
    try {
        keypair = await getWalletKeypairById(walletId)
        const connection = initializeConnection()
        const executor   = new Executor({ connection, wallet: keypair, defaultSlippage: slippage ?? 0.01, dryRun })
        const mint       = new PublicKey(mintAddress)
        const solAmount  = new BN(solAmountLamports)

        const result = await executor.buy(mint, solAmount, slippage)

        // ── Log trade (dry runs never touch the chain — skip logging those) ──
        if (!dryRun) {
            const logContext = await getTradeLogContext(mint, connection)
            await logTrade({
                walletId,
                side:         'BUY',
                exchange:     logContext.exchange,
                symbol:       logContext.symbol,
                toAddress:    mintAddress,
                amountSol:    lamportsBNToSolNumber(result.solAmount),
                quantity:     result.tokenAmount.toNumber(),
                price:        result.price,
                txSignature:  result.signature ?? null,
                status:       result.success ? 'confirmed' : 'failed',
                slippageBps:  Math.round((slippage ?? 0.01) * 10_000),
                priceImpact:  logContext.priceImpactPct,
                errorMessage: result.success ? null : result.error,
            })

            if (result.success && autoComment) {
                void maybeEnqueueCommentAfterBuy(walletId, mintAddress, autoComment, 'staggered_buy')
            }
        }

        return new Response(JSON.stringify({
            success:     result.success,
            signature:   result.signature,
            error:       parsePumpError(result.error),
            tokenAmount: result.tokenAmount.toString(),
        }), { status: 200, headers: { 'Content-Type': 'application/json' } })
    } catch (err) {
        keypair?.secretKey.fill(0)

        // Record the failed attempt — matters for debugging slippage
        // and priority-fee tuning
        if (!dryRun) {
            const rawSol = Number(solAmountLamports) / 1e9
            await logTrade({
                walletId,
                side:         'BUY',
                exchange:     'pump.fun',
                symbol:       mintAddress,
                toAddress:    mintAddress,
                amountSol:    Number.isFinite(rawSol) ? rawSol : null,
                status:       'failed',
                slippageBps:  Math.round((slippage ?? 0.01) * 10_000),
                errorMessage: (err as Error).message,
            })
        }

        return handleError(err)
    } finally {
        keypair?.secretKey.fill(0)
    }
}
