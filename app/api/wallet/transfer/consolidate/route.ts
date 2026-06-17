import { Keypair, PublicKey, SystemProgram, Transaction, sendAndConfirmTransaction } from '@solana/web3.js'
import { initializeQuickNodeSolana, parseAndValidateAddress } from '@/app/api/utils/helpers'
import { getWalletKeypairById } from '@/lib/vault/get-wallet-by-id'

export const dynamic = 'force-dynamic'

// Solana accounts must end at either >= rent-exempt minimum (~890 880 lamports)
// OR exactly 0 (account closes). 5 000 = the exact base fee for 1 signature, so
// sendAmount = balance - 5 000 drains the sender to exactly 0 — no rent violation.
const FEE_BUFFER_LAMPORTS = 5_000

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
        return new Response(JSON.stringify({ error: err instanceof Error ? err.message : 'Invalid receiver address.' }), {
            status: 400, headers: { 'Content-Type': 'application/json' },
        })
    }

    const { connection } = initializeQuickNodeSolana()
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

            const { blockhash } = await connection.getLatestBlockhash('confirmed')
            const transaction   = new Transaction()
            transaction.recentBlockhash = blockhash
            transaction.feePayer        = senderKeypair.publicKey
            transaction.add(
                SystemProgram.transfer({
                    fromPubkey: senderKeypair.publicKey,
                    toPubkey:   receiverPubkey,
                    lamports:   sendAmount,
                })
            )

            const signature = await sendAndConfirmTransaction(
                connection,
                transaction,
                [senderKeypair],
                { commitment: 'confirmed' },
            )

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
