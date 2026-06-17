import { Keypair, SystemProgram, Transaction } from '@solana/web3.js';
import { handleError, initializeQuickNodeSolana, parseAndValidateAddress } from '@/app/api/utils/helpers';
import { getWalletKeypairById } from '@/lib/vault/get-wallet-by-id';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
    const url = new URL(request.url);
    const senderWalletId        = url.searchParams.get('senderWalletId');
    const receiverWalletAddress = url.searchParams.get('receiverWalletAddress');
    const amountSOL             = parseFloat(url.searchParams.get('amountSOL') ?? '0');
    const lamports              = Math.round(amountSOL * 1_000_000_000);

    if (!senderWalletId) {
        return new Response(JSON.stringify({ error: 'senderWalletId is required.' }), {
            headers: { 'Content-Type': 'application/json' },
            status: 400,
        });
    }

    let senderSigner: Keypair | null = null;

    try {
        const receiverPublicKey = await parseAndValidateAddress(receiverWalletAddress);

        senderSigner = await getWalletKeypairById(senderWalletId);

        const transaction = new Transaction();
        transaction.add(
            SystemProgram.transfer({
                fromPubkey: senderSigner.publicKey,
                toPubkey:   receiverPublicKey,
                lamports,
            })
        );

        const solana    = initializeQuickNodeSolana();
        const signature = await solana.sendSmartTransaction({
            transaction,
            keyPair:   senderSigner,
            feeLevel: 'recommended',
        });

        return new Response(JSON.stringify({ signature }), {
            headers: { 'Content-Type': 'application/json' },
            status: 200,
        });
    } catch (error) {
        return handleError(error);
    } finally {
        senderSigner?.secretKey.fill(0);
    }
}
