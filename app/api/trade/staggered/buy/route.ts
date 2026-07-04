import { PublicKey } from '@solana/web3.js';
import BN from 'bn.js';
import { initializeConnection, handleError } from '@/app/api/utils/helpers';
import { getWalletKeypairById } from '@/lib/vault/get-wallet-by-id';
import { Executor } from '@/lib/pumpfun/executor';
import { parsePumpError } from '@/lib/pumpfun/errors';

export const dynamic    = 'force-dynamic';
export const maxDuration = 60;

export async function POST(request: Request) {
    let body: { walletId: string; mintAddress: string; solAmountLamports: string; slippage: number; dryRun?: boolean }
    try {
        body = await request.json()
    } catch {
        return new Response(JSON.stringify({ error: 'Invalid JSON body.' }), {
            status: 400,
            headers: { 'Content-Type': 'application/json' },
        })
    }

    const { walletId, mintAddress, solAmountLamports, slippage, dryRun } = body
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
        return new Response(JSON.stringify({
            success:     result.success,
            signature:   result.signature,
            error:       parsePumpError(result.error),
            tokenAmount: result.tokenAmount.toString(),
        }), { status: 200, headers: { 'Content-Type': 'application/json' } })
    } catch (err) {
        return handleError(err)
    } finally {
        keypair?.secretKey.fill(0)
    }
}
