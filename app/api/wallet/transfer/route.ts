import { Keypair, SystemProgram, Transaction } from '@solana/web3.js';
import { handleError, initializeQuickNodeSolana, parseAndValidateAddress } from '@/app/api/utils/helpers';
import { createClient } from '@/lib/supabase/server';
import bs58 from 'bs58';

function decodePrivateKey(raw: string): Uint8Array {
    // legacy format: Uint8Array.toString() → "1,2,3,...,64"
    if (raw.includes(',')) return Uint8Array.from(raw.split(',').map(Number));
    return bs58.decode(raw);
}

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
    const url = new URL(request.url);
    const senderWalletAddress = url.searchParams.get('senderWalletAddress');
    const receiverWalletAddress = url.searchParams.get('receiverWalletAddress');
    const amountSOL = parseFloat(url.searchParams.get('amountSOL') ?? '0');
    const lamports = Math.round(amountSOL * 1_000_000_000);

    try {
        const senderPublicKey = await parseAndValidateAddress(senderWalletAddress);
        const receiverPublicKey = await parseAndValidateAddress(receiverWalletAddress);

        const supabase = await createClient();
        const { data, error } = await supabase
            .from('wallets')
            .select('private_key')
            .eq('public_key', senderPublicKey.toBase58())
            .single();

        if (error || !data) {
            throw new Error('Sender wallet not found.');
        }

        const senderSigner = Keypair.fromSecretKey(decodePrivateKey(data.private_key));

        const transaction = new Transaction();
        transaction.add(
            SystemProgram.transfer({
                fromPubkey: senderPublicKey,
                toPubkey: receiverPublicKey,
                lamports,
            })
        );

        const solana = initializeQuickNodeSolana();
        const signature = await solana.sendSmartTransaction({
            transaction,
            keyPair: senderSigner,
            feeLevel: 'recommended',
        });

        return new Response(JSON.stringify({ signature }), {
            headers: { 'Content-Type': 'application/json' },
            status: 200,
        });
    } catch (error) {
        return handleError(error);
    }
}
