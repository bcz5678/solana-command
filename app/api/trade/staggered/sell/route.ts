import { PublicKey } from '@solana/web3.js';
import BN from 'bn.js';
import { initializeConnection, handleError } from '@/app/api/utils/helpers';
import { getWalletKeypairById } from '@/lib/vault/get-wallet-by-id';
import { Executor } from '@/lib/pumpfun/executor';
import { parsePumpError } from '@/lib/pumpfun/errors';

export const dynamic    = 'force-dynamic';
export const maxDuration = 120;

export async function POST(request: Request) {
    let body: { walletId: string; mintAddress: string; tokenAmount: string; slippage: number; sellPct?: number }
    try {
        body = await request.json()
    } catch {
        return new Response(JSON.stringify({ error: 'Invalid JSON body.' }), {
            status: 400,
            headers: { 'Content-Type': 'application/json' },
        })
    }

    const { walletId, mintAddress, tokenAmount, slippage, sellPct } = body
    if (!walletId || !mintAddress || !tokenAmount) {
        return new Response(JSON.stringify({ error: 'walletId, mintAddress, and tokenAmount are required.' }), {
            status: 400,
            headers: { 'Content-Type': 'application/json' },
        })
    }

    let keypair = null
    try {
        keypair = await getWalletKeypairById(walletId)
        const connection = initializeConnection()
        const executor   = new Executor({ connection, wallet: keypair, defaultSlippage: slippage ?? 0.01 })
        const mint       = new PublicKey(mintAddress)

        // Use sellAll for 100% sells — reads live on-chain balance and uses the
        // close-account instruction, avoiding rounding errors from the UI's
        // integer percentage calculation.
        if (sellPct === 100) {
            const result = await executor.sellAll(mint, slippage)
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

        // Loop to handle chunked sells (executor caps large amounts per call)
        let remaining  = new BN(tokenAmount)
        let totalSold  = new BN(0)
        let lastSig: string | undefined

        while (!remaining.isZero()) {
            const result = await executor.sell(mint, remaining, slippage)
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
        return handleError(err)
    } finally {
        keypair?.secretKey.fill(0)
    }
}
