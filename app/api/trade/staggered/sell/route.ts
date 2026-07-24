import { PublicKey } from '@solana/web3.js';
import BN from 'bn.js';
import { initializeConnection, handleError } from '@/app/api/utils/helpers';
import { getWalletKeypairById } from '@/lib/vault/get-wallet-by-id';
import { Executor } from '@/lib/pumpfun/executor';
import { parsePumpError } from '@/lib/pumpfun/errors';
import { logTrade } from '@/lib/trades/log';
import { getTradeLogContext } from '@/lib/trades/context';
import { lamportsBNToSolNumber } from '@/lib/lamports';

export const dynamic    = 'force-dynamic';
export const maxDuration = 120;

export async function POST(request: Request) {
    let body: { walletId: string; mintAddress: string; tokenAmount: string; slippage: number; sellPct?: number; dryRun?: boolean }
    try {
        body = await request.json()
    } catch {
        return new Response(JSON.stringify({ error: 'Invalid JSON body.' }), {
            status: 400,
            headers: { 'Content-Type': 'application/json' },
        })
    }

    const { walletId, mintAddress, tokenAmount, slippage, sellPct, dryRun } = body
    if (!walletId || !mintAddress || (tokenAmount == null && sellPct == null)) {
        return new Response(JSON.stringify({ error: 'walletId, mintAddress, and either tokenAmount or sellPct are required.' }), {
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
        const slippageBps = Math.round((slippage ?? 0.01) * 10_000)

        // Dry runs never touch the chain — skip logging those.
        const logContext = dryRun ? null : await getTradeLogContext(mint, connection)

        // Use sellAll for 100% sells — reads live on-chain balance and uses the
        // close-account instruction, avoiding rounding errors from the UI's
        // integer percentage calculation.
        if (sellPct === 100) {
            const result = await executor.sellAll(mint, slippage)

            if (logContext) {
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
                    slippageBps,
                    priceImpact:  logContext.priceImpactPct,
                    errorMessage: result.success ? null : result.error,
                })
            }

            if (!result.success) {
                return new Response(JSON.stringify({
                    success: false,
                    error:   parsePumpError(result.error) ?? 'Sell all failed.',
                }), { status: 200, headers: { 'Content-Type': 'application/json' } })
            }
            return new Response(JSON.stringify({
                success:         true,
                signature:       result.signature,
                tokenAmount:     result.tokenAmount.toString(),
                tokensRemaining: '0',
            }), { status: 200, headers: { 'Content-Type': 'application/json' } })
        }

        // A partial percentage (1-99) is resolved against the wallet's live
        // on-chain balance here — the client never knows the exact token
        // amount up front, since it depends on buys/transfers that happened
        // since the flow was built. 100% and an explicit tokenAmount are
        // handled by the branches above/below.
        let startAmount: BN
        if (typeof sellPct === 'number' && sellPct > 0 && sellPct < 100) {
            const liveBalance = await executor.getTokenBalance(mint)
            startAmount = liveBalance.muln(sellPct).divn(100)
            if (startAmount.isZero()) {
                return new Response(JSON.stringify({
                    success: false,
                    error:   'Wallet has no token balance to sell.',
                }), { status: 200, headers: { 'Content-Type': 'application/json' } })
            }
        } else {
            startAmount = new BN(tokenAmount)
        }

        // Loop to handle chunked sells (executor caps large amounts per call)
        let remaining  = startAmount
        let totalSold  = new BN(0)
        let lastSig: string | undefined

        while (!remaining.isZero()) {
            const result = await executor.sell(mint, remaining, slippage)

            if (logContext) {
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
                    slippageBps,
                    priceImpact:  logContext.priceImpactPct,
                    errorMessage: result.success ? null : result.error,
                })
            }

            if (!result.success) {
                return new Response(JSON.stringify({
                    success:         false,
                    error:           parsePumpError(result.error) ?? 'Sell failed.',
                    tokenAmount:     totalSold.toString(),
                    tokensRemaining: remaining.toString(),
                }), { status: 200, headers: { 'Content-Type': 'application/json' } })
            }
            totalSold = totalSold.add(result.tokenAmount)
            remaining = result.tokensRemaining
            if (result.signature) lastSig = result.signature
        }

        return new Response(JSON.stringify({
            success:         true,
            signature:       lastSig,
            tokenAmount:     totalSold.toString(),
            tokensRemaining: '0',
        }), { status: 200, headers: { 'Content-Type': 'application/json' } })
    } catch (err) {
        keypair?.secretKey.fill(0)

        // Record the failed attempt — matters for debugging slippage
        // and priority-fee tuning
        if (!dryRun) {
            const rawQuantity = tokenAmount != null ? Number(tokenAmount) : null
            await logTrade({
                walletId,
                side:         'SELL',
                exchange:     'pump.fun',
                symbol:       mintAddress,
                toAddress:    mintAddress,
                quantity:     rawQuantity != null && Number.isFinite(rawQuantity) ? rawQuantity : null,
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
