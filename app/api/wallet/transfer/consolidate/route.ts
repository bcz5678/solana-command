import { Keypair, PublicKey, SystemProgram, Transaction } from '@solana/web3.js'
import { handleError, initializeQuickNodeSolana, parseAndValidateAddress } from '@/app/api/utils/helpers'
import { getWalletKeypairById } from '@/lib/vault/get-wallet-by-id'

export const dynamic = 'force-dynamic'

// Mirrors consolidateSOL's txFeeBufferLamports — enough for base fee + recommended priority fee
const FEE_BUFFER_LAMPORTS = 10_000

type SenderInput  = { walletId: string }
type SenderResult = { walletId: string; success: boolean; swept?: number; signature?: string; error?: string }

function sleep(ms: number) {
    return new Promise<void>(resolve => setTimeout(resolve, ms))
}

export async function POST(request: Request) {
    let body: { receiverPublicKey: string; senders: SenderInput[] }
    try {
        body = await request.json()
    } catch {
        return new Response(JSON.stringify({ error: 'Invalid JSON body.' }), {
            status: 400, headers: { 'Content-Type': 'application/json' },
        })
    }

    const { receiverPublicKey, senders } = body
    if (!receiverPublicKey || !Array.isArray(senders) || senders.length === 0) {
        return new Response(JSON.stringify({ error: 'receiverPublicKey and senders[] are required.' }), {
            status: 400, headers: { 'Content-Type': 'application/json' },
        })
    }

    let receiverPubkey: PublicKey
    try {
        receiverPubkey = await parseAndValidateAddress(receiverPublicKey)
    } catch (err) {
        return handleError(err)
    }

    const solana     = initializeQuickNodeSolana()
    const connection = solana.connection
    const results: SenderResult[] = []

    for (let i = 0; i < senders.length; i++) {
        if (i > 0) await sleep(600)

        const { walletId } = senders[i]
        let senderKeypair: Keypair | null = null

        try {
            senderKeypair = await getWalletKeypairById(walletId)

            const balance    = await connection.getBalance(senderKeypair.publicKey, 'confirmed')
            const sendAmount = balance - FEE_BUFFER_LAMPORTS

            if (sendAmount <= 0) {
                results.push({ walletId, success: false, error: 'Insufficient balance after fees.' })
                continue
            }

            const transaction = new Transaction()
            transaction.add(
                SystemProgram.transfer({
                    fromPubkey: senderKeypair.publicKey,
                    toPubkey:   receiverPubkey,
                    lamports:   sendAmount,
                })
            )

            const signature = await solana.sendSmartTransaction({
                transaction,
                keyPair:  senderKeypair,
                feeLevel: 'recommended',
            })

            results.push({ walletId, success: true, swept: sendAmount, signature })
        } catch (err) {
            results.push({ walletId, success: false, error: err instanceof Error ? err.message : 'Transfer failed.' })
        } finally {
            senderKeypair?.secretKey.fill(0)
        }
    }

    return new Response(JSON.stringify({ results }), {
        status: 200, headers: { 'Content-Type': 'application/json' },
    })
}
