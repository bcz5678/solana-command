/**
 * quicknode-jito-executor.ts
 *
 * A class for Using the QUucknode Lil Jito addon to build and submit Jito bundles on Solana.
 * Supports constructing versioned transactions from:
 *  - A flat list of PublicKey addresses
 *  - An existing on-chain Address Lookup Table (ALT)
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
    appendTransactionMessageInstruction,
    TransactionPartialSigner,
    signTransactionMessageWithSigners,
    getBase64EncodedWireTransaction,
    Base64EncodedWireTransaction
} from "@solana/kit";
import { getAddMemoInstruction } from "@solana-program/memo";
import { getTransferSolInstruction } from "@solana-program/system";


const MINIMUM_JITO_TIP = 1_000; // lamports
const NUMBER_TRANSACTIONS = 5;
const SIMULATE_ONLY = true;
const ENDPOINT = process.env.SOLANA_RPC_URL
const POLL_TIMEOUT_MS = 30000;
const DEFAULT_WAIT_BEFORE_POLL_MS = 5000;




type JitoBundleSimulationResponse = {
    context: {
        apiVersion: string;
        slot: number;
    };
    value: {
        summary: 'succeeded' | {
            failed: {
                error: {
                    TransactionFailure: [number[], string];
                };
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
    getRegions(): string[];
    getTipAccounts(): Address[];
    getBundleStatuses(bundleIds: string[]): {
        context: { slot: number };
        value: {
            bundleId: string;
            transactions: Base58EncodedBytes[];
            slot: number;
            confirmationStatus: string;
            err: any;
        }[]
    };
    getInflightBundleStatuses(bundleIds: string[]): {
        context: { slot: number };
        value: {
            bundle_id: string;
            status: "Invalid" | "Pending" | "Landed" | "Failed";
            landed_slot: number | null;
        }[];
    };
    sendTransaction(transactions: Base64EncodedWireTransaction[]): string;
    simulateBundle(transactions: [Base64EncodedWireTransaction[]]): JitoBundleSimulationResponse;
    sendBundle(transactions: Base64EncodedWireTransaction[]): string;
}


function createJitoBundlesRpc({ endpoint }: { endpoint: string }): Rpc<LilJitAddon> {
    const api = createJsonRpcApi<LilJitAddon>({
        responseTransformer: (response: any) => response.result,
    });
    const transport = createDefaultRpcTransport({
        url: mainnet(endpoint),
    });
    return createRpc({ api, transport });
}


function isFailedSummary(summary: JitoBundleSimulationResponse['value']['summary']): summary is { failed: any } {
    return typeof summary === 'object' && summary !== null && 'failed' in summary;
}

function validateSimulation(simulation: JitoBundleSimulationResponse) {
    if (simulation.value.summary !== 'succeeded' && isFailedSummary(simulation.value.summary)) {
        throw new Error(`Simulation Failed: ${simulation.value.summary.failed.error.TransactionFailure[1]}`);
    }
}


async function createTransaction(
    index: number,
    latestBlockhash: Parameters<
        typeof setTransactionMessageLifetimeUsingBlockhash
    >[0],
    payerSigner: TransactionPartialSigner,
    includeTip?: Address
) {
    const transactionMessage = pipe(
        createTransactionMessage({ version: 0 }),
        (tx) => setTransactionMessageFeePayerSigner(payerSigner, tx),
        (tx) => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, tx),
        (tx) =>
            appendTransactionMessageInstruction(
                getAddMemoInstruction({
                    memo: `lil jit demo transaction # ${index}`,
                }),
                tx
            ),
        (tx) =>
            includeTip
                ? appendTransactionMessageInstruction(
                    getTransferSolInstruction({
                        source: payerSigner,
                        destination: includeTip,
                        amount: MINIMUM_JITO_TIP,
                    }),
                    tx
                )
                : tx
    );
    return await signTransactionMessageWithSigners(transactionMessage);
}

async function pollBundleStatus(
    rpc: Rpc<LilJitAddon>,
    bundleId: string,
    timeoutMs = 30000,
    pollIntervalMs = 3000,
    waitBeforePollMs = DEFAULT_WAIT_BEFORE_POLL_MS
) {
    await new Promise(resolve => setTimeout(resolve, waitBeforePollMs));

    const startTime = Date.now();
    let lastStatus = '';
    while (Date.now() - startTime < timeoutMs) {
        try {
            const bundleStatus = await rpc.getInflightBundleStatuses([bundleId]).send();
            const status = bundleStatus.value[0]?.status ?? 'Unknown';

            if (status !== lastStatus) {
                lastStatus = status;
            }

            if (status === 'Landed') {
                return true;
            }

            if (status === 'Failed') {
                console.log(`Bundle ${status.toLowerCase()}. Exiting...`);
                throw new Error(`Bundle failed with status: ${status}`);
            }

            await new Promise(resolve => setTimeout(resolve, pollIntervalMs));
        } catch {
            console.error('❌ - Error polling bundle status.');
        }
    }
    throw new Error("Polling timeout reached without confirmation");
}

