import { Keypair } from '@solana/web3.js';
import { handleError, initializeQuickNodeSolana, parseAndValidateAddress } from '@/app/api/utils/helpers';
import { getWalletKeypairById } from '@/lib/vault/get-wallet-by-id';
import { getTokenBalance } from '@/lib/trade/wallet-balance';
import { resolveMintInfo, uiAmountToRaw, sendTokenTransfer } from '@/lib/wallet/token-transfer';

export const dynamic = 'force-dynamic';

interface TokenSingleBody {
    senderWalletId?:  string
    receiverAddress?: string
    mintAddress?:     string
    amount?:          number
}

export async function POST(request: Request) {
    let body: TokenSingleBody;
    try {
        body = await request.json();
    } catch {
        return new Response(JSON.stringify({ error: 'Invalid JSON body.' }), {
            status: 400,
            headers: { 'Content-Type': 'application/json' },
        });
    }

    const { senderWalletId, receiverAddress, mintAddress, amount } = body;
    if (!senderWalletId || !receiverAddress || !mintAddress || !amount || amount <= 0) {
        return new Response(JSON.stringify({ error: 'senderWalletId, receiverAddress, mintAddress, and a positive amount are required.' }), {
            status: 400,
            headers: { 'Content-Type': 'application/json' },
        });
    }

    let senderSigner: Keypair | null = null;

    try {
        const receiverPublicKey = await parseAndValidateAddress(receiverAddress);
        const mint              = await parseAndValidateAddress(mintAddress);

        senderSigner = await getWalletKeypairById(senderWalletId);

        const solana    = initializeQuickNodeSolana();
        const mintInfo  = await resolveMintInfo(solana.connection, mint);
        const amountRaw = uiAmountToRaw(amount, mintInfo.decimals);

        const balance = await getTokenBalance(solana.connection, mint, senderSigner.publicKey, mintInfo.programId);
        if (BigInt(balance.toString()) < amountRaw) {
            return new Response(JSON.stringify({ error: 'Insufficient token balance.' }), {
                status: 400,
                headers: { 'Content-Type': 'application/json' },
            });
        }

        const signature = await sendTokenTransfer(solana, senderSigner, mint, receiverPublicKey, amountRaw, mintInfo);

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
