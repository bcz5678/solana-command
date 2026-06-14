/**
 * jitoExecutor.ts
 *
 * A class for building and submitting Jito bundles on Solana.
 * Supports constructing versioned transactions from:
 *  - A flat list of PublicKey addresses
 *  - An existing on-chain Address Lookup Table (ALT)
 *
 * Dependencies:
 *   yarn add jito-ts @solana/web3.js bs58
 */

import {
  AddressLookupTableAccount,
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import { searcher, bundle } from "jito-ts";
import type { SearcherClient } from "jito-ts/dist/sdk/block-engine/searcher";
import { LookupTable } from "@/lib/types/lookup-table";

// ─── Constants ───────────────────────────────────────────────────────────────

/** All 8 static Jito tip accounts (mainnet). One is chosen randomly per bundle. */
const JITO_TIP_ACCOUNTS: string[] = [
  "96gYZGLnJYVFmbjzopPSU6QiEV5fGqZNyN9nmNhvrZU5",
  "HFqU5x63VTqvQss8hp11i4bVqkfRtQ7NmXwkiCKDmpu",
  "Cw8CFyM9FkoMi7K7Crf6HNQqf4uEMzpKw6QNghXLvLkY",
  "ADaUMid9yfUytqMBgopwjb2DTLSLLWDMFf4t6U82o6QY",
  "DfXygSm4jCyNCybVYYK6DwvWqjKee8pbDmJGcLWNDXjh",
  "ADuUkR4vqLUMWXxW9gh6D6L8pMSawimctcNZ5pGwDcEt",
  "DttWaMuVvTiduZRnguLF7jNxTgiMBZ1hyAumKUiL2KRL",
  "3AVi9Tg9Uo68tJfuvoKvqKNWKkC5wPdSSdeBnizKZ6jT",
];

/** Jito enforces a hard maximum of 5 transactions per bundle. */
const MAX_BUNDLE_TXS = 5;

// ─── Types ───────────────────────────────────────────────────────────────────

export interface JitoExecutorConfig {
  /** Full gRPC block-engine URL, e.g. "mainnet.block-engine.jito.wtf" */
  blockEngineUrl: string;
  /** Pre-initialised Solana connection (use initializeQuickNodeSolana().connection) */
  connection: Connection;
  /** Fee payer / signer keypair */
  payer: Keypair;
  /**
   * Tip amount in lamports paid to a Jito tip account.
   * Minimum enforced by Jito is 1_000 lamports; more = higher priority.
   * @default 10_000
   */
  tipLamports?: number;
  /**
   * Whether to use static tip accounts instead of fetching live ones.
   * Fetching live ones adds one RPC call but guarantees freshness.
   * @default false
   */
  useStaticTipAccounts?: boolean;
}

export interface BundleResult {
  bundleId: string;
  status?: string;
}

// ─── JitoExecutor ────────────────────────────────────────────────────────────

export class JitoExecutor {
  private readonly connection: Connection;
  private readonly searcherClient: SearcherClient;
  private readonly payer: Keypair;
  private readonly tipLamports: number;
  private readonly useStaticTipAccounts: boolean;
  


  constructor(config: JitoExecutorConfig) {
    const {
      blockEngineUrl,
      connection,
      payer,
      tipLamports = 10_000,
      useStaticTipAccounts = true,
    } = config;

    this.connection = connection;
    // searcherClient handles the gRPC connection to the block-engine.
    // No auth keypair is required for the public HTTP-based bundle submission.
    this.searcherClient = searcher.searcherClient(blockEngineUrl);
    this.payer = payer;
    this.tipLamports = tipLamports;
    this.useStaticTipAccounts = useStaticTipAccounts;


    // Subscribe to async bundle results (fire-and-forget logging).
    // Replace this handler with your own persistence/alerting logic.
    this.searcherClient.onBundleResult(
      (result) => console.log("[JitoExecutor] Bundle result:", result),
      (err) => console.error("[JitoExecutor] Bundle result error:", err),
    );
  }

  // ─── Public API ────────────────────────────────────────────────────────────

  /**
   * Build and send a bundle whose transactions reference a flat list of
   * addresses. Each address gets wrapped in one transaction containing a
   * memo-style instruction (replace with your real instruction builder).
   *
   * In practice you'll pass your already-built TransactionInstruction[]
   * slices here — see `sendBundleFromInstructions` below for that variant.
   *
   * @param addresses - Public keys to include; max 4 (last slot reserved for tip tx)
   */
  async sendBundleFromAddresses(addresses: PublicKey[]): Promise<BundleResult> {
    if (addresses.length === 0) throw new Error("addresses array is empty");
    // Reserve last tx slot for the tip transaction
    if (addresses.length > MAX_BUNDLE_TXS - 1) {
      throw new Error(
        `Max ${MAX_BUNDLE_TXS - 1} addresses per bundle (last slot is the tip tx)`,
      );
    }

    const { blockhash } = await this.connection.getLatestBlockhash("confirmed");
    const tipAccount = await this.resolveTipAccount();

    // Build one transfer-to-self tx per address as a placeholder.
    // Replace this with your real instruction logic.
    const txs: VersionedTransaction[] = addresses.map((address) => {
      const ix = SystemProgram.transfer({
        fromPubkey: this.payer.publicKey,
        toPubkey: address,
        lamports: 1, // placeholder — swap for your real instruction
      });
      return this.buildVersionedTx([ix], blockhash);
    });

    // Append a standalone tip transaction as the last tx in the bundle
    const tipTx = this.buildTipTx(tipAccount, blockhash);
    txs.push(tipTx);

    return this.submitBundle(txs);
  }

  /**
   * Build and send a bundle whose transactions are compressed using the best
   * subset of the supplied Address Lookup Tables. Fetches all ALTs, scores
   * them against the instruction addresses, picks the optimal ≤4, then builds
   * and submits the bundle.
   *
   * @param altAddresses    - LookupTable records whose on-chain ALTs to load
   * @param instructionSets - Array of instruction arrays, one per transaction (max 4 sets)
   */
  async sendBundleFromLookupTables(
    altAddresses: LookupTable[],
    instructionSets: TransactionInstruction[][],
  ): Promise<BundleResult> {
    if (instructionSets.length === 0) throw new Error("instructionSets is empty");
    if (instructionSets.length > MAX_BUNDLE_TXS - 1) {
      throw new Error(
        `Max ${MAX_BUNDLE_TXS - 1} instruction sets per bundle (last slot is the tip tx)`,
      );
    }

    const altAccounts = await this.fetchALTs(altAddresses);
    const { lookupTables, addressesForLookupTable, lookupTablesForAddress } =
      this.buildLookupTableIndexes(altAccounts);

    const allAddresses = extractAddressesFromInstructions(instructionSets.flat());
    const idealTables = this.computeIdealLookupTablesForAddresses(
      allAddresses,
      lookupTables,
      addressesForLookupTable,
      lookupTablesForAddress,
    );

    const [{ blockhash }, tipAccount] = await Promise.all([
      this.connection.getLatestBlockhash("confirmed"),
      this.resolveTipAccount(),
    ]);

    const txs: VersionedTransaction[] = instructionSets.map((ixs) =>
      this.buildVersionedTx(ixs, blockhash, idealTables),
    );
    txs.push(this.buildTipTx(tipAccount, blockhash, idealTables));

    return this.submitBundle(txs);
  }

  /**
   * Send a bundle from already-built, already-signed VersionedTransactions.
   * Use this when each transaction has its own signer (e.g. multi-wallet bundle
   * trades where every wallet signs its own buy/sell tx). The executor appends
   * a tip transaction signed by the fee payer and submits the bundle.
   *
   * @param txs - Pre-signed VersionedTransactions (max 4; last slot is the tip tx)
   */
  async sendPrebuiltTransactions(txs: VersionedTransaction[]): Promise<BundleResult> {
    if (txs.length === 0) throw new Error("txs array is empty");
    if (txs.length > MAX_BUNDLE_TXS - 1) {
      throw new Error(
        `Max ${MAX_BUNDLE_TXS - 1} transactions per bundle (last slot is the tip tx)`,
      );
    }

    const [{ blockhash }, tipAccount] = await Promise.all([
      this.connection.getLatestBlockhash("confirmed"),
      this.resolveTipAccount(),
    ]);

    const tipTx = this.buildTipTx(tipAccount, blockhash);
    return this.submitBundle([...txs, tipTx]);
  }

  /**
   * Send a bundle from pre-built instruction sets without an ALT.
   * Useful when you've already assembled your instructions and just
   * want the executor to handle tip injection + submission.
   *
   * @param instructionSets - Array of instruction arrays, one per transaction (max 4 sets)
   */
  async sendBundleFromInstructions(
    instructionSets: TransactionInstruction[][],
  ): Promise<BundleResult> {
    if (instructionSets.length === 0) throw new Error("instructionSets is empty");
    if (instructionSets.length > MAX_BUNDLE_TXS - 1) {
      throw new Error(
        `Max ${MAX_BUNDLE_TXS - 1} instruction sets per bundle (last slot is the tip tx)`,
      );
    }

    const { blockhash } = await this.connection.getLatestBlockhash("confirmed");
    const tipAccount = await this.resolveTipAccount();

    const txs: VersionedTransaction[] = instructionSets.map((ixs) =>
      this.buildVersionedTx(ixs, blockhash),
    );

    const tipTx = this.buildTipTx(tipAccount, blockhash);
    txs.push(tipTx);

    return this.submitBundle(txs);
  }

  /**
   * Poll Jito for the final status of a submitted bundle.
   * Call this after sendBundle* resolves if you need on-chain confirmation.
   *
   * @param bundleId - The bundle ID returned by a send* method
   * @param maxAttempts - Max polling iterations before giving up (@default 20)
   * @param intervalMs  - Delay between polls in ms (@default 1500)
   */
  async waitForBundleLanding(bundleId: string, timeoutMs = 30_000): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error(`Bundle ${bundleId} did not land within timeout`)),
        timeoutMs,
      );

      const cancel = this.searcherClient.onBundleResult(
        (result) => {
          if (result.bundleId !== bundleId) return;
          clearTimeout(timer);
          cancel();

          if (result.finalized) return resolve("finalized");
          if (result.processed) return resolve("processed");
          if (result.dropped)   return reject(new Error(`Bundle ${bundleId} dropped`));
          if (result.rejected) {
            const reason =
              result.rejected.simulationFailure?.msg ??
              result.rejected.internalError?.msg ??
              result.rejected.droppedBundle?.msg ??
              JSON.stringify(result.rejected);
            return reject(new Error(`Bundle ${bundleId} rejected: ${reason}`));
          }
        },
        (err) => {
          clearTimeout(timer);
          cancel();
          reject(err);
        },
      );
    });
  }

  // ─── Public Helpers ────────────────────────────────────────────────────────

  /**
   * Fetch all ALTs, score them against the provided instructions, and return
   * the optimal subset (≤4 tables, each covering ≥2 addresses).
   * Returns an empty array if altRecords is empty or no table matches.
   */
  async resolveOptimalLookupTables(
    altRecords: LookupTable[],
    instructions: TransactionInstruction[],
  ): Promise<AddressLookupTableAccount[]> {
    if (altRecords.length === 0) return [];
    const altAccounts = await this.fetchALTs(altRecords);
    const { lookupTables, addressesForLookupTable, lookupTablesForAddress } =
      this.buildLookupTableIndexes(altAccounts);
    const allAddresses = extractAddressesFromInstructions(instructions);
    return this.computeIdealLookupTablesForAddresses(
      allAddresses,
      lookupTables,
      addressesForLookupTable,
      lookupTablesForAddress,
    );
  }

  // ─── Private Helpers ───────────────────────────────────────────────────────

  /** Fetch and validate all ALT accounts in parallel. */
  private async fetchALTs(tables: LookupTable[]): Promise<AddressLookupTableAccount[]> {
    return Promise.all(
      tables.map(async (lt) => {
        const address = new PublicKey(lt.public_address);
        const { value } = await this.connection.getAddressLookupTable(address);
        if (!value) throw new Error(`ALT not found: ${lt.public_address}`);
        if (!value.isActive()) throw new Error(`ALT deactivated: ${lt.public_address}`);
        return value;
      }),
    );
  }

  /** Build reverse-lookup index maps from a set of fetched ALT accounts. */
  private buildLookupTableIndexes(alts: AddressLookupTableAccount[]): {
    lookupTables: Map<string, AddressLookupTableAccount>;
    addressesForLookupTable: Map<string, Set<string>>;
    lookupTablesForAddress: Map<string, Set<string>>;
  } {
    const lookupTables = new Map<string, AddressLookupTableAccount>();
    const addressesForLookupTable = new Map<string, Set<string>>();
    const lookupTablesForAddress = new Map<string, Set<string>>();

    for (const alt of alts) {
      const lutKey = alt.key.toBase58();
      lookupTables.set(lutKey, alt);
      const addrSet = new Set<string>();
      for (const addr of alt.state.addresses) {
        const addrStr = addr.toBase58();
        addrSet.add(addrStr);
        const tablesForAddr = lookupTablesForAddress.get(addrStr) ?? new Set<string>();
        tablesForAddr.add(lutKey);
        lookupTablesForAddress.set(addrStr, tablesForAddr);
      }
      addressesForLookupTable.set(lutKey, addrSet);
    }

    return { lookupTables, addressesForLookupTable, lookupTablesForAddress };
  }

  private computeIdealLookupTablesForAddresses(
    addresses: PublicKey[],
    lookupTables: Map<string, AddressLookupTableAccount>,
    addressesForLookupTable: Map<string, Set<string>>,
    lookupTablesForAddress: Map<string, Set<string>>,
  ): AddressLookupTableAccount[] {
    const MIN_ADDRESSES_TO_INCLUDE_TABLE = 2;
    const MAX_TABLE_COUNT = 4;

    const addressSet = new Set<string>();
    const tableIntersections = new Map<string, number>();
    const selectedTables: AddressLookupTableAccount[] = [];
    const remainingAddresses = new Set<string>();

    for (const address of addresses) {
      const addressStr = address.toBase58();
      if (addressSet.has(addressStr)) continue;
      addressSet.add(addressStr);

      const tablesForAddress = lookupTablesForAddress.get(addressStr) ?? new Set<string>();
      if (tablesForAddress.size === 0) continue;

      remainingAddresses.add(addressStr);
      for (const table of tablesForAddress) {
        tableIntersections.set(table, (tableIntersections.get(table) ?? 0) + 1);
      }
    }

    const sorted = Array.from(tableIntersections.entries()).sort((a, b) => b[1] - a[1]);

    for (const [lutKey, intersectionSize] of sorted) {
      if (intersectionSize < MIN_ADDRESSES_TO_INCLUDE_TABLE) break;
      if (selectedTables.length >= MAX_TABLE_COUNT) break;
      if (remainingAddresses.size <= 1) break;

      const lutAddresses = addressesForLookupTable.get(lutKey);
      if (!lutAddresses) continue;

      const addressMatches = new Set([...remainingAddresses].filter((x) => lutAddresses.has(x)));

      if (addressMatches.size >= MIN_ADDRESSES_TO_INCLUDE_TABLE) {
        const table = lookupTables.get(lutKey);
        if (table) {
          selectedTables.push(table);
          for (const address of addressMatches) remainingAddresses.delete(address);
        }
      }
    }

    return selectedTables;
  }


  /**
   * Build a versioned (v0) transaction with optional ALT compression.
   * The payer signs immediately — if your flow requires additional signers,
   * collect their signatures before calling submitBundle.
   */
  private buildVersionedTx(
    instructions: TransactionInstruction[],
    recentBlockhash: string,
    lookupTables: AddressLookupTableAccount[] = [],
  ): VersionedTransaction {
    const message = new TransactionMessage({
      payerKey: this.payer.publicKey,
      recentBlockhash,
      instructions,
    }).compileToV0Message(lookupTables);

    const tx = new VersionedTransaction(message);
    tx.sign([this.payer]);
    return tx;
  }

  /**
   * Build the tip transaction that pays the Jito validator.
   * This is always the LAST transaction in the bundle.
   */
  private buildTipTx(
    tipAccount: PublicKey,
    recentBlockhash: string,
    lookupTables: AddressLookupTableAccount[] = [],
  ): VersionedTransaction {
    const tipIx = SystemProgram.transfer({
      fromPubkey: this.payer.publicKey,
      toPubkey: tipAccount,
      lamports: this.tipLamports,
    });
    return this.buildVersionedTx([tipIx], recentBlockhash, lookupTables);
  }

  /**
   * Resolve a tip account address, either from the static list or by
   * querying the block-engine for currently active tip accounts.
   */
  private async resolveTipAccount(): Promise<PublicKey> {
    if (this.useStaticTipAccounts) {
      const idx = Math.floor(Math.random() * JITO_TIP_ACCOUNTS.length);
      return new PublicKey(JITO_TIP_ACCOUNTS[idx]);
    }

    // Dynamic: fetch from block-engine (adds ~1 RPC round-trip)
    const result = await this.searcherClient.getTipAccounts();
    if (!result.ok) throw result.error;
    if (!result.value.length) throw new Error("No tip accounts returned from block-engine");
    return new PublicKey(result.value[Math.floor(Math.random() * result.value.length)]);
  }

  /**
   * Wrap transactions in a Bundle and submit to Jito.
   * jito-ts Bundle constructor validates the 5-tx hard cap internally.
   */
  private async submitBundle(txs: VersionedTransaction[]): Promise<BundleResult> {
    const jitoBundle = new bundle.Bundle(txs, MAX_BUNDLE_TXS);

    const result = await this.searcherClient.sendBundle(jitoBundle);
    if (!result.ok) throw result.error;
    console.log(`[JitoExecutor] Bundle submitted: ${result.value}`);

    return { bundleId: result.value };
  }
}

// ─── Utility ─────────────────────────────────────────────────────────────────

function extractAddressesFromInstructions(instructions: TransactionInstruction[]): PublicKey[] {
  const seen = new Set<string>();
  const result: PublicKey[] = [];
  for (const ix of instructions) {
    for (const { pubkey } of ix.keys) {
      const str = pubkey.toBase58();
      if (!seen.has(str)) {
        seen.add(str);
        result.push(pubkey);
      }
    }
  }
  return result;
}

// ─── Usage Example ───────────────────────────────────────────────────────────
/*
import { Keypair, PublicKey } from "@solana/web3.js";
import { JitoExecutor } from "./jitoExecutor";

const payer = Keypair.fromSecretKey(Uint8Array.from([...])); // your keypair

const executor = new JitoExecutor({
  blockEngineUrl: "mainnet.block-engine.jito.wtf",
  rpcUrl: "https://your-rpc-url",
  payer,
  tipLamports: 10_000,
  useStaticTipAccounts: false,
});

// --- Option 1: from a list of addresses ---
const addresses = [
  new PublicKey("addr1..."),
  new PublicKey("addr2..."),
];
const { bundleId } = await executor.sendBundleFromAddresses(addresses);
await executor.waitForBundleLanding(bundleId);

// --- Option 2: from an existing ALT ---
const altAddress = new PublicKey("your-alt-address...");
const instructionSets = [
  [myIx1, myIx2],   // tx 1
  [myIx3],          // tx 2
];
const { bundleId: id2 } = await executor.sendBundleFromLookupTable(altAddress, instructionSets);
await executor.waitForBundleLanding(id2);

// --- Option 3: pre-built instructions, no ALT ---
const { bundleId: id3 } = await executor.sendBundleFromInstructions([[myIx1], [myIx2]]);
*/