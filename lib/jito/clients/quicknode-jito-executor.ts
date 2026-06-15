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
    createDefaultRpcTransport,
    createRpc,
    createJsonRpcApi,
    Address,
    mainnet,
    Base58EncodedBytes,
    createSolanaRpc,
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

// ─── Internal RPC factory ────────────────────────────────────────────────────

function createLilJitRpc(endpoint: string): Rpc<LilJitAddon> {
    const api = createJsonRpcApi<LilJitAddon>({
        responseTransformer: (response: unknown) => (response as { result: unknown }).result,
    });
    const transport = createDefaultRpcTransport({ url: mainnet(endpoint) });
    return createRpc({ api, transport });
}

// ─── QuicknodeJitoExecutor ───────────────────────────────────────────────────

export class QuicknodeJitoExecutor {
    private readonly solanaRpc: ReturnType<typeof createSolanaRpc>;
    private readonly lilJitRpc: Rpc<LilJitAddon>;
    private readonly signer: TransactionPartialSigner | null;
    private readonly tipLamports: number;
    private readonly simulateOnly: boolean;
    private readonly pollTimeoutMs: number;
    private readonly pollIntervalMs: number;
    private readonly waitBeforePollMs: number;

    private constructor(
        solanaRpc: ReturnType<typeof createSolanaRpc>,
        lilJitRpc: Rpc<LilJitAddon>,
        signer: TransactionPartialSigner | null,
        tipLamports: number,
        simulateOnly: boolean,
        pollTimeoutMs: number,
        pollIntervalMs: number,
        waitBeforePollMs: number,
    ) {
        this.solanaRpc = solanaRpc;
        this.lilJitRpc = lilJitRpc;
        this.signer = signer;
        this.tipLamports = tipLamports;
        this.simulateOnly = simulateOnly;
        this.pollTimeoutMs = pollTimeoutMs;
        this.pollIntervalMs = pollIntervalMs;
        this.waitBeforePollMs = waitBeforePollMs;
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
            createSolanaRpc(config.endpoint),
            createLilJitRpc(config.endpoint),
            signer,
            Math.max(config.tipLamports ?? 10_000, 1_000),
            config.simulateOnly ?? false,
            config.pollTimeoutMs ?? 30_000,
            config.pollIntervalMs ?? 1_000,
            config.waitBeforePollMs ?? 1_500,
        );
    }

    // ─── Public API ───────────────────────────────────────────────────────────

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

                if (status === 'Failed' || status === 'Invalid') {
                    throw new Error(`Bundle ${bundleId} status: ${status}`);
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
