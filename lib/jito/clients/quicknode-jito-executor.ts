/**
 * QuicknodeJitoExecutor
 *
 * Executor client for Jito bundles via the QuickNode Lil Jito RPC addon.
 * Supports single-wallet and multi-wallet (up to 5 tx) bundles.
 *
 * Security: raw keypair bytes are zeroed from memory immediately after signer creation.
 */

import {
    Rpc,
    createRpc,
    createJsonRpcApi,
    Address,
    Base58EncodedBytes,
    createSolanaRpcFromTransport,
    createKeyPairSignerFromBytes,
    createTransactionMessage,
    setTransactionMessageFeePayerSigner,
    pipe,
    setTransactionMessageLifetimeUsingBlockhash,
    appendTransactionMessageInstructions,
    TransactionPartialSigner,
    signTransactionMessageWithSigners,
    getBase64EncodedWireTransaction,
    Base64EncodedWireTransaction,
    type Instruction,
} from "@solana/kit";
import { getTransferSolInstruction } from "@solana-program/system";
import { request as undiciRequest } from "undici";

// ─── Types ───────────────────────────────────────────────────────────────────

type JitoBundleSimulationResponse = {
    context: {
        apiVersion: string;
        slot: number;
    };
    value: {
        summary:
            | 'succeeded'
            | {
                  failed: {
                      error: { TransactionFailure: [number[], string] };
                      tx_signature: string;
                  };
              };
        transactionResults: Array<{
            err: null | unknown;
            logs: string[];
            postExecutionAccounts: null | unknown;
            preExecutionAccounts: null | unknown;
            returnData: null | unknown;
            unitsConsumed: number;
        }>;
    };
};

type LilJitAddon = {
    getTipAccounts(): Address[];
    getRegions(): string[];
    getBundleStatuses(bundleIds: string[]): {
        context: { slot: number };
        value: {
            bundleId: string;
            transactions: Base58EncodedBytes[];
            slot: number;
            confirmationStatus: string;
            err: unknown;
        }[];
    };
    getInflightBundleStatuses(bundleIds: string[]): {
        context: { slot: number };
        value: {
            bundle_id: string;
            status: 'Invalid' | 'Pending' | 'Landed' | 'Failed';
            landed_slot: number | null;
        }[];
    };
    simulateBundle(
        transactions: [Base64EncodedWireTransaction[]],
    ): JitoBundleSimulationResponse;
    sendBundle(transactions: Base64EncodedWireTransaction[]): string;
};

// ─── Config / Result ─────────────────────────────────────────────────────────

export interface QuicknodeJitoExecutorConfig {
    /** QuickNode RPC endpoint URL — must have the Lil Jito addon enabled */
    endpoint: string;
    /**
     * Raw 64-byte secret key — zeroed from memory after signer creation.
     * Required only for sendSingleTransaction; omit when using sendMultiWalletBundle.
     */
    secretKey?: Uint8Array;
    /**
     * Jito tip in lamports. Minimum is 1_000 (enforced).
     * @default 10_000
     */
    tipLamports?: number;
    /** Stop after simulation without sending the bundle. @default false */
    simulateOnly?: boolean;
    /** Total ms to wait for bundle confirmation. @default 30_000 */
    pollTimeoutMs?: number;
    /** Interval between status polls in ms. @default 1_000 */
    pollIntervalMs?: number;
    /** Initial delay before the first poll in ms. @default 1_500 */
    waitBeforePollMs?: number;
    /**
     * When true, treats a Jito "Invalid" bundle status as likely-landed and returns
     * normally instead of throwing. Use only with endpoints that do not support
     * getBundleStatuses (e.g. QuickNode Lil Jito). Callers must verify via on-chain
     * state (e.g. ATA balance check). @default false
     */
    optimisticOnInvalid?: boolean;
}

/** One wallet's contribution to a multi-wallet bundle. */
export interface WalletBundle {
    /** Raw 64-byte secret key — zeroed from memory after the transaction is signed. */
    secretKey: Uint8Array;
    instructions: Instruction[];
}

export interface BundleResult {
    bundleId: string;
    /** true when simulateOnly — bundleId is empty */
    simulated: boolean;
    /** All signer addresses included in the bundle */
    signerAddresses: string[];
}

// ─── Transient-failure retry ──────────────────────────────────────────────────
//
// getTipAccount()/simulateBundle()/sendBundle() were each a single unretried
// .send() call — any transient network hiccup on the Lil Jito RPC surface
// (confirmed live 2026-09-07: every bundle-sell attempt in a ~1hr window
// failed with a bare undici "fetch failed" while the SAME endpoint's regular
// Connection-based calls — getLatestBlockhash, sendTransaction, etc., used by
// every non-bundle trade route — kept succeeding throughout) turned into an
// immediate, total failure with nothing to retry it. Same isProxyNetworkError
// classification comment-bot.ts already uses for its proxy calls: this is
// specifically a dead/failed connection attempt, not an application-level
// rejection (bad params, insufficient funds, etc.) — those still throw
// immediately, unretried, since a fresh attempt can't fix a real rejection.
const JITO_RPC_MAX_ATTEMPTS = 3;

function isNetworkFetchFailure(err: unknown): boolean {
    return err instanceof TypeError && err.message === 'fetch failed';
}

// undici's fetch() throws `TypeError('fetch failed', { cause })` where `cause`
// is the actual underlying error (a SocketError/ConnectTimeoutError, or a
// plain Node errno error like ECONNRESET/ETIMEDOUT/ENOTFOUND) — but the outer
// message is always the same generic "fetch failed" regardless of which of
// those it was. That's exactly what made the 2026-09-07 incident (and every
// attempt since) impossible to diagnose from trade_logs alone: every failed
// row says the same generic string no matter the real cause. Surface the
// cause explicitly instead of discarding it.
function describeFetchFailureCause(err: unknown): string {
    const cause = err instanceof Error ? err.cause : undefined;
    if (cause == null) return 'no cause reported';
    if (cause instanceof Error) {
        const code = (cause as NodeJS.ErrnoException).code;
        return code ? `${code}: ${cause.message}` : `${cause.name}: ${cause.message}`;
    }
    return String(cause);
}

async function withJitoRpcRetry<T>(label: string, fn: () => Promise<T>): Promise<T> {
    for (let attempt = 1; attempt <= JITO_RPC_MAX_ATTEMPTS; attempt++) {
        try {
            return await fn();
        } catch (err) {
            if (!isNetworkFetchFailure(err)) throw err;
            const causeDesc = describeFetchFailureCause(err);
            if (attempt === JITO_RPC_MAX_ATTEMPTS) {
                throw new Error(`${label}: fetch failed (after ${JITO_RPC_MAX_ATTEMPTS} attempts) — ${causeDesc}`, { cause: err });
            }
            console.warn(`[QuicknodeJitoExecutor] ${label}: network fetch failed (attempt ${attempt}/${JITO_RPC_MAX_ATTEMPTS}) — ${causeDesc}, retrying…`);
            await new Promise((r) => setTimeout(r, 300 + Math.random() * 500));
        }
    }
    // Unreachable — the loop above always returns or throws.
    throw new Error(`withJitoRpcRetry: exhausted attempts for ${label}`);
}

// ─── Internal RPC factory ────────────────────────────────────────────────────
//
// Root cause of the bare "fetch failed" / "UND_ERR_INVALID_ARG: invalid
// content-length header" seen live (see withJitoRpcRetry's cause-surfacing
// below, which is what made this diagnosable instead of just "fetch failed"):
// this project's Next.js version (16.2.4) globally monkey-patches `fetch()`
// inside every route handler for its own Data Cache / request-memoization
// layer (next/dist/server/lib/patch-fetch.js), reconstructing `init` — body,
// headers — before handing off to the real fetch. Confirmed by a direct A/B
// test against a live route handler: the exact same getTipAccounts call
// failed 8/8 through @solana/kit's default transport (which calls the
// globally-patched `fetch`) and succeeded 8/8 using undici's own `request()`
// — a lower-level API Next's patch never touches (it only wraps
// `globalThis.fetch`, not the userland `undici` package). A standalone
// script outside the Next.js request-handler runtime never reproduced the
// bug at all, which is what pointed at the patched-fetch layer as the actual
// cause rather than network flakiness — two earlier network-layer theories
// (an idle-keepalive race, then rapid-fire connection throttling) were each
// tested and ruled out before this one.
function createUnpatchedFetchTransport(endpoint: string) {
    return async function transport<TResponse>({
        payload,
        signal,
    }: {
        payload: unknown;
        signal?: AbortSignal;
    }): Promise<TResponse> {
        const body = JSON.stringify(payload);
        const { statusCode, body: responseBody } = await undiciRequest(endpoint, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body,
            signal,
        });
        const text = await responseBody.text();
        if (statusCode < 200 || statusCode >= 300) {
            throw new Error(`HTTP ${statusCode}: ${text}`);
        }
        return JSON.parse(text) as TResponse;
    };
}

function createLilJitRpc(endpoint: string): Rpc<LilJitAddon> {
    const api = createJsonRpcApi<LilJitAddon>({
        responseTransformer: (response: unknown) => (response as { result: unknown }).result,
    });
    const transport = createUnpatchedFetchTransport(endpoint);
    return createRpc({ api, transport });
}

// ─── QuicknodeJitoExecutor ───────────────────────────────────────────────────

export class QuicknodeJitoExecutor {
    private readonly solanaRpc: ReturnType<typeof createSolanaRpcFromTransport>;
    private readonly lilJitRpc: Rpc<LilJitAddon>;
    private readonly signer: TransactionPartialSigner | null;
    private readonly tipLamports: number;
    private readonly simulateOnly: boolean;
    private readonly pollTimeoutMs: number;
    private readonly pollIntervalMs: number;
    private readonly waitBeforePollMs: number;
    private readonly optimisticOnInvalid: boolean;

    private constructor(
        solanaRpc: ReturnType<typeof createSolanaRpcFromTransport>,
        lilJitRpc: Rpc<LilJitAddon>,
        signer: TransactionPartialSigner | null,
        tipLamports: number,
        simulateOnly: boolean,
        pollTimeoutMs: number,
        pollIntervalMs: number,
        waitBeforePollMs: number,
        optimisticOnInvalid: boolean,
    ) {
        this.solanaRpc = solanaRpc;
        this.lilJitRpc = lilJitRpc;
        this.signer = signer;
        this.tipLamports = tipLamports;
        this.simulateOnly = simulateOnly;
        this.pollTimeoutMs = pollTimeoutMs;
        this.pollIntervalMs = pollIntervalMs;
        this.waitBeforePollMs = waitBeforePollMs;
        this.optimisticOnInvalid = optimisticOnInvalid;
    }

    /**
     * Factory. If secretKey is provided it is zeroed after the signer is derived.
     * Omit secretKey when using sendMultiWalletBundle — keys are passed per wallet there.
     */
    static async create(config: QuicknodeJitoExecutorConfig): Promise<QuicknodeJitoExecutor> {
        let signer: TransactionPartialSigner | null = null;

        if (config.secretKey) {
            const keyBytes = new Uint8Array(config.secretKey);
            signer = await createKeyPairSignerFromBytes(keyBytes);
            keyBytes.fill(0);
            config.secretKey.fill(0);
        }

        return new QuicknodeJitoExecutor(
            createSolanaRpcFromTransport(createUnpatchedFetchTransport(config.endpoint)),
            createLilJitRpc(config.endpoint),
            signer,
            Math.max(config.tipLamports ?? 10_000, 1_000),
            config.simulateOnly ?? false,
            config.pollTimeoutMs ?? 30_000,
            config.pollIntervalMs ?? 1_000,
            config.waitBeforePollMs ?? 1_500,
            config.optimisticOnInvalid ?? false,
        );
    }

    // ─── Public API ───────────────────────────────────────────────────────────

    /**
     * Returns a random Jito tip account address. Used by callers that build
     * their own transactions (e.g. packed multi-wallet bundles via sendPrebuiltBundle).
     */
    async getTipAccount(): Promise<Address> {
        const tipAccounts = await withJitoRpcRetry('getTipAccounts', () => this.lilJitRpc.getTipAccounts().send());
        if (tipAccounts.length === 0) throw new Error('Lil Jito returned no tip accounts');
        return tipAccounts[Math.floor(Math.random() * tipAccounts.length)];
    }

    /**
     * Accepts pre-built, pre-signed, base64-encoded versioned transactions.
     * Simulates, submits, and polls. The caller is responsible for embedding
     * the Jito tip transfer in one of the transactions before encoding.
     *
     * Max 5 transactions (Jito bundle limit).
     */
    async sendPrebuiltBundle(
        encodedTransactions: Base64EncodedWireTransaction[],
        signerAddresses: string[] = [],
    ): Promise<BundleResult> {
        if (encodedTransactions.length === 0) throw new Error('encodedTransactions array is empty');
        if (encodedTransactions.length > 5) throw new Error('Jito bundles support at most 5 transactions');

        console.log(`[QuicknodeJitoExecutor] simulating prebuilt bundle (${encodedTransactions.length} txs)`);
        const simulation = await withJitoRpcRetry('simulateBundle', () => this.lilJitRpc.simulateBundle([encodedTransactions]).send());
        this.validateSimulation(simulation);
        console.log(`[QuicknodeJitoExecutor] simulation succeeded`);

        if (this.simulateOnly) {
            return { bundleId: '', simulated: true, signerAddresses };
        }

        // Safe to retry on a bare network failure — these transactions are
        // already signed against a fixed blockhash, so resubmitting the exact
        // same bundle after a dropped response (not a dropped submission) is
        // just a duplicate of the same signatures, not a double-spend.
        const bundleId = await withJitoRpcRetry('sendBundle', () => this.lilJitRpc.sendBundle(encodedTransactions).send());
        console.log(`[QuicknodeJitoExecutor] bundle submitted: ${bundleId}`);

        await this.pollBundleStatus(bundleId);
        console.log(`[QuicknodeJitoExecutor] bundle landed: ${bundleId}`);
        console.log(`     https://explorer.jito.wtf/bundle/${bundleId}`);

        return { bundleId, simulated: false, signerAddresses };
    }

    /**
     * Single-wallet path. Builds one transaction containing the provided
     * instructions + tip transfer, simulates as a bundle, submits, and polls.
     * Requires secretKey to have been passed to create().
     */
    async sendSingleTransaction(instructions: Instruction[]): Promise<BundleResult> {
        if (!this.signer) throw new Error("sendSingleTransaction requires secretKey in create() config");
        if (instructions.length === 0) throw new Error("instructions array is empty");

        const [tipAccounts, { value: latestBlockhash }] = await Promise.all([
            this.lilJitRpc.getTipAccounts().send(),
            this.solanaRpc.getLatestBlockhash({ commitment: 'confirmed' }).send(),
        ]);
        if (tipAccounts.length === 0) throw new Error("Lil Jito returned no tip accounts");
        const tipAddress = tipAccounts[Math.floor(Math.random() * tipAccounts.length)];
        console.log(`[QuicknodeJitoExecutor] tip: ${tipAddress} | blockhash: ${latestBlockhash.blockhash}`);

        const txMsg = pipe(
            createTransactionMessage({ version: 0 }),
            (tx) => setTransactionMessageFeePayerSigner(this.signer!, tx),
            (tx) => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, tx),
            (tx) => appendTransactionMessageInstructions(
                [...instructions, getTransferSolInstruction({
                    source: this.signer!,
                    destination: tipAddress,
                    amount: BigInt(this.tipLamports),
                })],
                tx,
            ),
        );

        const signedTx = await signTransactionMessageWithSigners(txMsg);
        const encoded = getBase64EncodedWireTransaction(signedTx) as Base64EncodedWireTransaction;

        const simulation = await this.lilJitRpc.simulateBundle([[encoded]]).send();
        this.validateSimulation(simulation);
        console.log(`[QuicknodeJitoExecutor] simulation succeeded`);

        if (this.simulateOnly) {
            return { bundleId: '', simulated: true, signerAddresses: [this.signer.address] };
        }

        const bundleId = await this.lilJitRpc.sendBundle([encoded]).send();
        console.log(`[QuicknodeJitoExecutor] bundle submitted: ${bundleId}`);

        await this.pollBundleStatus(bundleId);
        console.log(`[QuicknodeJitoExecutor] bundle landed: ${bundleId}`);
        console.log(`     https://explorer.jito.wtf/bundle/${bundleId}`);

        return { bundleId, simulated: false, signerAddresses: [this.signer.address] };
    }

    /**
     * Multi-wallet bundle (1–5 transactions). Each wallet signs its own transaction.
     * The tip is embedded as a transfer instruction in the last wallet's transaction.
     * Each secretKey is zeroed from memory immediately after the transaction is signed.
     *
     * @param wallets - One entry per trade wallet, in submission order.
     *   Max 5 (Jito bundle limit). The last wallet pays the tip.
     */
    async sendMultiWalletBundle(wallets: WalletBundle[]): Promise<BundleResult> {
        if (wallets.length === 0) throw new Error("wallets array is empty");
        if (wallets.length > 5) throw new Error("Jito bundles support at most 5 transactions");

        const [tipAccounts, { value: latestBlockhash }] = await Promise.all([
            this.lilJitRpc.getTipAccounts().send(),
            this.solanaRpc.getLatestBlockhash({ commitment: 'confirmed' }).send(),
        ]);
        if (tipAccounts.length === 0) throw new Error("Lil Jito returned no tip accounts");
        const tipAddress = tipAccounts[Math.floor(Math.random() * tipAccounts.length)];
        console.log(`[QuicknodeJitoExecutor] tip: ${tipAddress} | blockhash: ${latestBlockhash.blockhash} | wallets: ${wallets.length}`);

        const encodedTxs: Base64EncodedWireTransaction[] = [];
        const signerAddresses: string[] = [];

        for (let i = 0; i < wallets.length; i++) {
            const { secretKey, instructions } = wallets[i];
            const isLast = i === wallets.length - 1;

            const keyBytes = new Uint8Array(secretKey);
            const signer = await createKeyPairSignerFromBytes(keyBytes);
            keyBytes.fill(0);
            secretKey.fill(0);

            signerAddresses.push(signer.address);

            const allInstructions: Instruction[] = isLast
                ? [...instructions, getTransferSolInstruction({
                      source: signer,
                      destination: tipAddress,
                      amount: BigInt(this.tipLamports),
                  })]
                : instructions;

            const txMsg = pipe(
                createTransactionMessage({ version: 0 }),
                (tx) => setTransactionMessageFeePayerSigner(signer, tx),
                (tx) => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, tx),
                (tx) => appendTransactionMessageInstructions(allInstructions, tx),
            );

            const signedTx = await signTransactionMessageWithSigners(txMsg);
            encodedTxs.push(getBase64EncodedWireTransaction(signedTx) as Base64EncodedWireTransaction);
            console.log(`[QuicknodeJitoExecutor] wallet[${i}] ${signer.address} signed`);
        }

        const simulation = await this.lilJitRpc.simulateBundle([encodedTxs]).send();
        this.validateSimulation(simulation);
        console.log(`[QuicknodeJitoExecutor] simulation succeeded (${encodedTxs.length} txs)`);

        if (this.simulateOnly) {
            return { bundleId: '', simulated: true, signerAddresses };
        }

        const bundleId = await this.lilJitRpc.sendBundle(encodedTxs).send();
        console.log(`[QuicknodeJitoExecutor] bundle submitted: ${bundleId}`);

        await this.pollBundleStatus(bundleId);
        console.log(`[QuicknodeJitoExecutor] bundle landed: ${bundleId}`);
        console.log(`     https://explorer.jito.wtf/bundle/${bundleId}`);

        return { bundleId, simulated: false, signerAddresses };
    }

    // ─── Private helpers ──────────────────────────────────────────────────────

    private validateSimulation(sim: JitoBundleSimulationResponse): void {
        sim.value.transactionResults.forEach((r, i) => {
            const cu = r.unitsConsumed ?? '?';
            const status = r.err ? `ERR: ${JSON.stringify(r.err)}` : `OK (CU=${cu})`;
            console.log(`[QuicknodeJitoExecutor] sim tx[${i}] ${status}`);
            if (r.logs?.length) console.log(`  logs: ${r.logs.slice(-5).join(' | ')}`);
        });

        const { summary } = sim.value;
        if (summary !== 'succeeded' && typeof summary === 'object' && 'failed' in summary) {
            const msg = summary.failed.error.TransactionFailure[1];
            throw new Error(`Bundle simulation failed: ${msg}`);
        }
    }

    private async pollBundleStatus(bundleId: string): Promise<void> {
        await new Promise((r) => setTimeout(r, this.waitBeforePollMs));

        const deadline = Date.now() + this.pollTimeoutMs;
        let lastStatus = '';

        while (Date.now() < deadline) {
            try {
                const res = await this.lilJitRpc.getInflightBundleStatuses([bundleId]).send();
                const status = res.value[0]?.status ?? 'Unknown';

                if (status !== lastStatus) {
                    console.log(`[QuicknodeJitoExecutor] bundle ${bundleId} → ${status}`);
                    lastStatus = status;
                }

                if (status === 'Landed') return;

                if (status === 'Failed') {
                    throw new Error(`Bundle ${bundleId} status: Failed`);
                }

                if (status === 'Invalid') {
                    // "Invalid" = bundle left the inflight queue (landed or dropped).
                    // Poll getBundleStatuses: a landed bundle appears in the results;
                    // a dropped bundle never does. Poll up to 5× at 2s gaps (10s window)
                    // to cover both "confirmed" (~2-3s) and "finalized" (~13s) timing.
                    let landed = false;
                    for (let attempt = 0; attempt < 5 && !landed; attempt++) {
                        await new Promise(r => setTimeout(r, 2_000));
                        try {
                            const finalRes = await this.lilJitRpc.getBundleStatuses([bundleId]).send();
                            // Any entry in the response means the bundle was included in a block.
                            // Dropped bundles are simply absent from the results.
                            if (finalRes.value[0]) {
                                const cs = finalRes.value[0].confirmationStatus;
                                console.log(`[QuicknodeJitoExecutor] bundle ${bundleId} in ledger (attempt ${attempt + 1}): ${cs ?? 'unknown'}`);
                                landed = true;
                            }
                        } catch (e) {
                            console.warn(`[QuicknodeJitoExecutor] getBundleStatuses error (attempt ${attempt + 1}):`, e);
                        }
                    }
                    if (landed) return;
                    if (this.optimisticOnInvalid) {
                        // getBundleStatuses found nothing — could be a very late confirmation
                        // or a genuine drop. Return so the caller can verify via on-chain state.
                        console.warn(`[QuicknodeJitoExecutor] bundle ${bundleId}: not found in ledger after retries — returning optimistically`);
                        return;
                    }
                    throw new Error(`Bundle ${bundleId} status: Invalid`);
                }
            } catch (err) {
                if (
                    err instanceof Error &&
                    (err.message.includes('Failed') || err.message.includes('Invalid'))
                ) {
                    throw err;
                }
                console.warn(`[QuicknodeJitoExecutor] poll error:`, err);
            }

            await new Promise((r) => setTimeout(r, this.pollIntervalMs));
        }

        throw new Error(`Bundle ${bundleId} did not land within ${this.pollTimeoutMs}ms`);
    }
}
