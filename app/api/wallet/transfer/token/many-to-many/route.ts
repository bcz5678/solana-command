import { Keypair, PublicKey } from '@solana/web3.js';
import { handleError, initializeQuickNodeSolana, parseAndValidateAddress } from '@/app/api/utils/helpers';
import { getWalletKeypairById } from '@/lib/vault/get-wallet-by-id';
import { getTokenBalance } from '@/lib/trade/wallet-balance';
import { resolveMintInfo, uiAmountToRaw, sendTokenTransfer } from '@/lib/wallet/token-transfer';

export const dynamic = 'force-dynamic';

type TransferInput = {
    fromWalletId: string
    toWalletId?:  string
    toAddress:    string
    amount:       number
}

type TransferResult = {
    fromWalletId: string
    toWalletId?:  string
    toAddress:    string
    amount:       number
    success:      boolean
    signature?:   string
    error?:       string
}

function sleep(ms: number) {
    return new Promise<void>((resolve) => setTimeout(resolve, ms))
}

export async function POST(request: Request) {
    let body: { mintAddress?: string; transfers?: TransferInput[] };
    try {
        body = await request.json();
    } catch {
        return new Response(JSON.stringify({ error: 'Invalid JSON body.' }), {
            status: 400,
            headers: { 'Content-Type': 'application/json' },
        });
    }

    const { mintAddress, transfers } = body;
    if (!mintAddress || !Array.isArray(transfers) || transfers.length === 0) {
        return new Response(JSON.stringify({ error: 'mintAddress and transfers are required.' }), {
            status: 400,
            headers: { 'Content-Type': 'application/json' },
        });
    }

    // One keypair fetched per distinct sender (not per edge — a sender can
    // appear in several transfers), wiped in `finally` regardless of outcome.
    const keypairs = new Map<string, Keypair>();

    try {
        const mint     = await parseAndValidateAddress(mintAddress);
        const solana   = initializeQuickNodeSolana();
        const mintInfo = await resolveMintInfo(solana.connection, mint);

        for (const t of transfers) {
            if (!t.fromWalletId || !t.toAddress || !t.amount || t.amount <= 0) {
                return new Response(JSON.stringify({ error: 'Every transfer needs fromWalletId, toAddress, and a positive amount.' }), {
                    status: 400,
                    headers: { 'Content-Type': 'application/json' },
                });
            }
        }

        // Resolve every distinct sender's keypair up front.
        for (const t of transfers) {
            if (!keypairs.has(t.fromWalletId)) {
                keypairs.set(t.fromWalletId, await getWalletKeypairById(t.fromWalletId));
            }
        }

        // Pre-flight: each sender's on-chain balance must cover the SUM of
        // everything they're sending across this whole batch — checked
        // before anything executes, same "don't discover a shortfall
        // partway through" reasoning as the 1-to-many route, extended here
        // to however many distinct senders are in the batch.
        const totalsByWallet = new Map<string, bigint>();
        for (const t of transfers) {
            const raw = uiAmountToRaw(t.amount, mintInfo.decimals);
            totalsByWallet.set(t.fromWalletId, (totalsByWallet.get(t.fromWalletId) ?? BigInt(0)) + raw);
        }

        const shortfalls: string[] = [];
        for (const [walletId, totalRaw] of totalsByWallet) {
            const keypair = keypairs.get(walletId)!;
            const balanceRaw = BigInt(
                (await getTokenBalance(solana.connection, mint, keypair.publicKey, mintInfo.programId)).toString(),
            );
            if (balanceRaw < totalRaw) {
                shortfalls.push(keypair.publicKey.toBase58());
            }
        }
        if (shortfalls.length > 0) {
            return new Response(JSON.stringify({
                error: `Insufficient token balance for the total requested from: ${shortfalls.join(', ')}`,
            }), {
                status: 400,
                headers: { 'Content-Type': 'application/json' },
            });
        }

        const results: TransferResult[] = [];

        for (let i = 0; i < transfers.length; i++) {
            // 600ms gap ensures each tx gets a fresh blockhash slot — same
            // convention as the 1-to-many route, applied flat across the
            // whole batch rather than per-sender for simplicity.
            if (i > 0) await sleep(600);

            const t = transfers[i];
            try {
                const senderKeypair = keypairs.get(t.fromWalletId)!;
                const toPublicKey   = new PublicKey(t.toAddress);
                const amountRaw     = uiAmountToRaw(t.amount, mintInfo.decimals);

                const signature = await sendTokenTransfer(solana, senderKeypair, mint, toPublicKey, amountRaw, mintInfo);

                results.push({ fromWalletId: t.fromWalletId, toWalletId: t.toWalletId, toAddress: t.toAddress, amount: t.amount, success: true, signature });
            } catch (err) {
                results.push({
                    fromWalletId: t.fromWalletId,
                    toWalletId:   t.toWalletId,
                    toAddress:    t.toAddress,
                    amount:       t.amount,
                    success:      false,
                    error:        err instanceof Error ? err.message : 'Transfer failed.',
                });
            }
        }

        return new Response(JSON.stringify({ results }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
        });
    } catch (err) {
        return handleError(err);
    } finally {
        for (const keypair of keypairs.values()) keypair.secretKey.fill(0);
    }
}
