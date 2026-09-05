import { Keypair } from '@solana/web3.js';
import { handleError, initializeQuickNodeSolana, parseAndValidateAddress } from '@/app/api/utils/helpers';
import { getWalletKeypairById } from '@/lib/vault/get-wallet-by-id';
import { getTokenBalance } from '@/lib/trade/wallet-balance';
import { resolveMintInfo, uiAmountToRaw, sendTokenTransfer } from '@/lib/wallet/token-transfer';

export const dynamic = 'force-dynamic';

type ReceiverInput = {
    walletId?:  string
    publicKey:  string
    amount:     number
}

type ReceiverResult = {
    walletId?:  string
    publicKey:  string
    success:    boolean
    signature?: string
    error?:     string
}

function sleep(ms: number) {
    return new Promise<void>((resolve) => setTimeout(resolve, ms))
}

export async function POST(request: Request) {
    let body: { senderWalletId?: string; mintAddress?: string; receivers?: ReceiverInput[] };
    try {
        body = await request.json();
    } catch {
        return new Response(JSON.stringify({ error: 'Invalid JSON body.' }), {
            status: 400,
            headers: { 'Content-Type': 'application/json' },
        });
    }

    const { senderWalletId, mintAddress, receivers } = body;
    if (!senderWalletId || !mintAddress || !Array.isArray(receivers) || receivers.length === 0) {
        return new Response(JSON.stringify({ error: 'senderWalletId, mintAddress, and receivers are required.' }), {
            status: 400,
            headers: { 'Content-Type': 'application/json' },
        });
    }

    let senderKeypair: Keypair | null = null;
    try {
        senderKeypair = await getWalletKeypairById(senderWalletId);
    } catch (err) {
        return handleError(err);
    }

    const solana = initializeQuickNodeSolana();
    const results: ReceiverResult[] = [];

    try {
        const mint     = await parseAndValidateAddress(mintAddress);
        const mintInfo = await resolveMintInfo(solana.connection, mint);

        // Pre-flight: total requested must not exceed the current balance — a
        // run that drains mid-way is confusing (some receivers paid, others
        // rejected on-chain for insufficient funds), so catch the obvious
        // case up front rather than discovering it partway through the loop.
        const totalRaw = receivers.reduce((sum, r) => sum + uiAmountToRaw(r.amount, mintInfo.decimals), BigInt(0));
        const balanceRaw = BigInt(
            (await getTokenBalance(solana.connection, mint, senderKeypair.publicKey, mintInfo.programId)).toString(),
        );
        if (balanceRaw < totalRaw) {
            return new Response(JSON.stringify({ error: 'Insufficient token balance for the total requested across all receivers.' }), {
                status: 400,
                headers: { 'Content-Type': 'application/json' },
            });
        }

        for (let i = 0; i < receivers.length; i++) {
            // 600ms gap ensures each tx gets a fresh blockhash slot — same
            // convention as the SOL fund route.
            if (i > 0) await sleep(600);

            const receiver = receivers[i];
            try {
                const receiverPublicKey = await parseAndValidateAddress(receiver.publicKey);
                const amountRaw = uiAmountToRaw(receiver.amount, mintInfo.decimals);

                const signature = await sendTokenTransfer(solana, senderKeypair, mint, receiverPublicKey, amountRaw, mintInfo);

                results.push({ walletId: receiver.walletId, publicKey: receiver.publicKey, success: true, signature });
            } catch (err) {
                results.push({
                    walletId:  receiver.walletId,
                    publicKey: receiver.publicKey,
                    success:   false,
                    error:     err instanceof Error ? err.message : 'Transfer failed.',
                });
            }
        }
    } catch (err) {
        return handleError(err);
    } finally {
        senderKeypair.secretKey.fill(0);
    }

    return new Response(JSON.stringify({ results }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
    });
}
