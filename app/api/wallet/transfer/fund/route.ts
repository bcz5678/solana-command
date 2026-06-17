import { Keypair, SystemProgram, Transaction } from '@solana/web3.js';
import { handleError, initializeQuickNodeSolana, parseAndValidateAddress } from '@/app/api/utils/helpers';
import { getWalletKeypairById } from '@/lib/vault/get-wallet-by-id';

export const dynamic = 'force-dynamic';

type ReceiverInput = {
    walletId:  string
    publicKey: string
    amountSOL: number
}

type ReceiverResult = {
    walletId:   string
    success:    boolean
    signature?: string
    error?:     string
}

function sleep(ms: number) {
    return new Promise<void>((resolve) => setTimeout(resolve, ms))
}

export async function POST(request: Request) {
    let body: { senderWalletId: string; receivers: ReceiverInput[] }
    try {
        body = await request.json()
    } catch {
        return new Response(JSON.stringify({ error: 'Invalid JSON body.' }), {
            status: 400,
            headers: { 'Content-Type': 'application/json' },
        })
    }

    const { senderWalletId, receivers } = body
    if (!senderWalletId || !Array.isArray(receivers) || receivers.length === 0) {
        return new Response(JSON.stringify({ error: 'senderWalletId and receivers are required.' }), {
            status: 400,
            headers: { 'Content-Type': 'application/json' },
        })
    }

    let senderKeypair: Keypair | null = null
    try {
        senderKeypair = await getWalletKeypairById(senderWalletId)
    } catch (err) {
        return handleError(err)
    }

    const solana = initializeQuickNodeSolana()
    const results: ReceiverResult[] = []

    try {
        for (let i = 0; i < receivers.length; i++) {
            // 600ms gap ensures each tx gets a fresh blockhash slot
            if (i > 0) await sleep(600)

            const receiver = receivers[i]
            try {
                const receiverPublicKey = await parseAndValidateAddress(receiver.publicKey)
                const lamports = Math.round(receiver.amountSOL * 1_000_000_000)

                const transaction = new Transaction()
                transaction.add(
                    SystemProgram.transfer({
                        fromPubkey: senderKeypair.publicKey,
                        toPubkey:   receiverPublicKey,
                        lamports,
                    })
                )

                const signature = await solana.sendSmartTransaction({
                    transaction,
                    keyPair:  senderKeypair,
                    feeLevel: 'recommended',
                })

                results.push({ walletId: receiver.walletId, success: true, signature })
            } catch (err) {
                results.push({
                    walletId: receiver.walletId,
                    success:  false,
                    error:    err instanceof Error ? err.message : 'Transfer failed.',
                })
            }
        }
    } finally {
        senderKeypair.secretKey.fill(0)
    }

    return new Response(JSON.stringify({ results }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
    })
}
