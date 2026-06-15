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
import { ed25519 } from "@noble/curves/ed25519";
import bs58 from "bs58";
import { searcher, bundle as jitoBundle } from "jito-ts";
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
  signatures: string[];
  status?: string;
}

// ─── JitoExecutor ────────────────────────────────────────────────────────────

export class JitoExecutor {
  private readonly connection: Connection;
  private readonly searcherClient: SearcherClient;
  private readonly payer: Keypair;
  private readonly tipLamports: number;
  private readonly useStaticTipAccounts: boolean;
  private readonly blockEngineUrl: string;

  constructor(config: JitoExecutorConfig) {
    const {
      blockEngineUrl,
      connection,
      payer,
      tipLamports = 10_000,
      useStaticTipAccounts = false,
    } = config;

    this.blockEngineUrl = blockEngineUrl;
    this.connection = connection;
    this.searcherClient = searcher.searcherClient(blockEngineUrl);
    this.payer = payer;
    this.tipLamports = tipLamports;
    this.useStaticTipAccounts = useStaticTipAccounts;
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
    console.log(`sendBundleFromAddresses`);

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
    
    console.log(`sendBundleFromLookupTables`);


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
    const rawIdealTables = this.computeIdealLookupTablesForAddresses(
      allAddresses,
      lookupTables,
      addressesForLookupTable,
      lookupTablesForAddress,
    );
    // Tip accounts must be static (not ALT-resolved) or Jito rejects the bundle
    const idealTables = this.filterTipAccountsFromALTs(rawIdealTables);

    const { blockhash } = await this.connection.getLatestBlockhash("confirmed");

    const txs: VersionedTransaction[] = instructionSets.map((ixs) =>
      this.buildVersionedTx(ixs, blockhash, idealTables),
    );

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
    console.log(`sendPrebuiltTransactions`);

    if (txs.length === 0) throw new Error("txs array is empty");
    if (txs.length > MAX_BUNDLE_TXS - 1) {
      throw new Error(
        `Max ${MAX_BUNDLE_TXS - 1} transactions per bundle (last slot is the tip tx)`,
      );
    }


    // sigVerify:true + replaceRecentBlockhash:false gives the closest possible
    // match to what Jito's block engine runs: actual sig check + actual blockhash.
    // Routes now use a 'finalized' blockhash so the node is guaranteed to have it.
    // If this produces BlockhashNotFound, fall back to replaceRecentBlockhash:true
    // so we still catch program errors without blocking on a lagging simulation node.
    for (let i = 0; i < txs.length; i++) {
      let sim = await this.connection.simulateTransaction(txs[i], {
        sigVerify: true,
        replaceRecentBlockhash: false,
      });

      if (sim.value.err) {
        const errStr = JSON.stringify(sim.value.err);

        if (errStr.includes('BlockhashNotFound')) {
          console.warn(`[JitoExecutor] Tx[${i}] simulation node lacks blockhash — retrying with replaceRecentBlockhash:true`);
          sim = await this.connection.simulateTransaction(txs[i], {
            sigVerify: false,
            replaceRecentBlockhash: true,
          });
        }

        if (sim.value.err) {
          const logs = sim.value.logs?.join('\n') ?? '(no logs)';
          throw new Error(`Tx[${i}] simulation failed: ${JSON.stringify(sim.value.err)}\n${logs}`);
        }
      }

      // Log simulation output so we can see CU usage and any program warnings
      const cuUsed = sim.value.unitsConsumed ?? '?';
      const simLogs = sim.value.logs ?? [];
      console.log(`[JitoExecutor] Tx[${i}] simulation OK | CU=${cuUsed}`);
      if (simLogs.length > 0) {
        // Print last 10 log lines to avoid flooding — enough to catch program errors
        const tail = simLogs.slice(-10);
        console.log(`[JitoExecutor] Tx[${i}] sim logs (last ${tail.length}):\n  ${tail.join('\n  ')}`);
      }
    }

    return this.submitBundle(txs);
  }

  /**
   * Like sendPrebuiltTransactions, but the tip is already embedded as a
   * SystemProgram.transfer instruction inside the last trade tx. No separate
   * tip transaction is added — the bundle contains only the supplied txs.
   *
   * The last trade wallet is responsible for the tip payment, which means:
   * - Single-wallet bundle: that wallet pays for both the trade and the tip.
   * - Multi-wallet bundle: the last wallet in the list pays the tip.
   *
   * @param txs - Pre-signed VersionedTransactions (max 5; tip is inline)
   */
  async sendPrebuiltTransactionsWithInlineTip(txs: VersionedTransaction[]): Promise<BundleResult> {
    console.log(`sendPrebuiltTransactionsWithInlineTip`);

    if (txs.length === 0) throw new Error("txs array is empty");
    if (txs.length > MAX_BUNDLE_TXS) {
      throw new Error(`Max ${MAX_BUNDLE_TXS} transactions per bundle`);
    }

    for (let i = 0; i < txs.length; i++) {
      let sim = await this.connection.simulateTransaction(txs[i], {
        sigVerify: true,
        replaceRecentBlockhash: false,
      });

      if (sim.value.err) {
        const errStr = JSON.stringify(sim.value.err);

        if (errStr.includes('BlockhashNotFound')) {
          console.warn(`[JitoExecutor] Tx[${i}] simulation node lacks blockhash — retrying with replaceRecentBlockhash:true`);
          sim = await this.connection.simulateTransaction(txs[i], {
            sigVerify: false,
            replaceRecentBlockhash: true,
          });
        }

        if (sim.value.err) {
          const logs = sim.value.logs?.join('\n') ?? '(no logs)';
          throw new Error(`Tx[${i}] simulation failed: ${JSON.stringify(sim.value.err)}\n${logs}`);
        }
      }

      const cuUsed = sim.value.unitsConsumed ?? '?';
      const simLogs = sim.value.logs ?? [];
      console.log(`[JitoExecutor] Tx[${i}] simulation OK | CU=${cuUsed}`);
      if (simLogs.length > 0) {
        const tail = simLogs.slice(-10);
        console.log(`[JitoExecutor] Tx[${i}] sim logs (last ${tail.length}):\n  ${tail.join('\n  ')}`);
      }
    }

    // Verify each signature cryptographically before submission.
    // Jito's block engine runs the same check and returns "Invalid" if any sig fails.
    for (let i = 0; i < txs.length; i++) {
      const msgBytes = txs[i].message.serialize();
      const sig      = txs[i].signatures[0];
      const pubkey   = txs[i].message.staticAccountKeys[0].toBytes();
      const valid    = ed25519.verify(sig, msgBytes, pubkey);
      console.log(`[JitoExecutor] Tx[${i}] sig verify: ${valid ? 'VALID' : 'INVALID'} | signer: ${txs[i].message.staticAccountKeys[0].toBase58()}`);
      if (!valid) throw new Error(`Tx[${i}] has an invalid signature — re-sign before submitting`);
    }

    return this.submitBundle(txs, 5, true);
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
    console.log(`sendBundleFromInstructions`);;

    if (instructionSets.length === 0) throw new Error("instructionSets is empty");
    if (instructionSets.length > MAX_BUNDLE_TXS - 1) {
      throw new Error(
        `Max ${MAX_BUNDLE_TXS - 1} instruction sets per bundle (last slot is the tip tx)`,
      );
    }

    const { blockhash } = await this.connection.getLatestBlockhash("confirmed");

    console.log(`sendBundleFromInstructions -> blockhash: ${blockhash}`);

    const txs: VersionedTransaction[] = instructionSets.map((ixs) =>
      this.buildVersionedTx(ixs, blockhash),
    );

    console.log(`sendBundleFromInstructions -> txs: ${txs}`);

    return this.submitBundle(txs);
  }

  /**
   * Poll Jito for the final status of a submitted bundle.
   *
   * Strategy:
   * 1. getInflightBundleStatuses — reflects Pending/Failed/Landed while in-flight
   *    (getBundleStatuses returns value:[] for pending bundles, so it can't be used alone).
   * 2. Signature-status fallback — confirms on-chain even if Jito API lags.
   *
   * @param bundleId   - The bundle ID returned by a send* method
   * @param signatures - Trade-tx signatures for the on-chain fallback check
   * @param timeoutMs  - Total time to wait before giving up (@default 60_000)
   * @param intervalMs - Delay between polls (@default 2_000)
   */
  async waitForBundleLanding(
    bundleId: string,
    signatures: string[] = [],
    timeoutMs = 60_000,
    intervalMs = 2_000,
  ): Promise<string> {
    const endpoint = `https://${this.blockEngineUrl}/api/v1/bundles`;
    const deadline = Date.now() + timeoutMs;

    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, intervalMs));

      // ── 1. getInflightBundleStatuses (Pending / Failed / Landed) ──
      try {
        const res = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            jsonrpc: '2.0', id: 1,
            method: 'getInflightBundleStatuses',
            params: [[bundleId]],
          }),
        });
        const text = await res.text();
        console.log(`[JitoExecutor] inflight HTTP ${res.status}:`, text);
        if (res.ok) {
          const json = JSON.parse(text);
          const entry = json?.result?.value?.[0];
          if (entry) {
            const s = entry.status as string;
            if (s === 'Failed' || s === 'Invalid') throw new Error(`Bundle ${bundleId} status: ${s} — check https://explorer.jito.wtf/bundle/${bundleId}`);
            if (s === 'Landed') {
              console.log(`[JitoExecutor] Bundle landed (slot ${entry.landed_slot})`);
              return 'confirmed';
            }
            // s === 'Pending' → keep polling
          }
        }
      } catch (err) {
        if (err instanceof Error && err.message.startsWith('Bundle ')) throw err;
        console.warn(`[JitoExecutor] inflight poll error:`, err);
      }

      // ── 2. Signature fallback — confirms on-chain even if Jito API lags ──
      if (signatures.length > 0) {
        try {
          const statuses = await this.connection.getSignatureStatuses(signatures);
          const landed = statuses.value.find(
            (s) => s && (s.confirmationStatus === 'confirmed' || s.confirmationStatus === 'finalized'),
          );
          if (landed) {
            const level = landed.confirmationStatus!;
            console.log(`[JitoExecutor] Confirmed via signature check: ${level}`);
            return level;
          }
        } catch (e) {
          console.warn(`[JitoExecutor] signature status check failed:`, e);
        }
      }
    }

    throw new Error(`Bundle ${bundleId} did not land within ${timeoutMs}ms`);
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
    const ideal = this.computeIdealLookupTablesForAddresses(
      allAddresses,
      lookupTables,
      addressesForLookupTable,
      lookupTablesForAddress,
    );
    // Tip accounts must never be resolved via ALT — Jito requires a static write lock
    return this.filterTipAccountsFromALTs(ideal);
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

  /** Strip any known Jito tip accounts out of ALT results before use in trade txs. */
  private filterTipAccountsFromALTs(
    alts: AddressLookupTableAccount[],
  ): AddressLookupTableAccount[] {
    const tipSet = new Set(JITO_TIP_ACCOUNTS);
    return alts.map((alt) => ({
      ...alt,
      state: {
        ...alt.state,
        addresses: alt.state.addresses.filter((a) => !tipSet.has(a.toBase58())),
      },
    })) as AddressLookupTableAccount[];
  }

  /**
   * Resolve a tip account address. Always attempts a live gRPC lookup first
   * so we use the current epoch's accounts; falls back to the static list if
   * the gRPC call fails or useStaticTipAccounts is true.
   *
   * Public so routes can resolve the account before building transactions
   * (needed for the inline-tip approach where the tip instruction is
   * embedded in the trade tx itself rather than in a separate tip tx).
   */
  async resolveTipAccount(): Promise<PublicKey> {
    if (!this.useStaticTipAccounts) {
      try {
        const result = await this.searcherClient.getTipAccounts();
        if (result.ok && result.value.length > 0) {
          const addr = result.value[Math.floor(Math.random() * result.value.length)];
          console.log(`[JitoExecutor] tip account (dynamic): ${addr}`);
          return new PublicKey(addr);
        }
        if (!result.ok) console.warn('[JitoExecutor] getTipAccounts error:', result.error.message);
      } catch (e) {
        console.warn('[JitoExecutor] getTipAccounts gRPC failed, using static list:', e);
      }
    }

    const idx = Math.floor(Math.random() * JITO_TIP_ACCOUNTS.length);
    const addr = JITO_TIP_ACCOUNTS[idx];
    console.log(`[JitoExecutor] tip account (static): ${addr}`);
    return new PublicKey(addr);
  }

  /**
   * Build and submit a bundle to Jito via gRPC (the native interface).
   *
   * Uses the jito-ts Bundle class and searcherClient.sendBundle() so the
   * bundle is transmitted over the same gRPC channel that getTipAccounts()
   * already uses — avoiding any REST encoding ambiguity.
   * addTipTx() internally creates a SystemProgram.transfer that write-locks
   * the tip account as Jito requires.
   *
   * Status polling remains over REST (getInflightBundleStatuses).
   * Retries on gRPC resource-exhausted / rate-limit errors.
   */
  /**
   * @param tipInTxs - When true, the tip instruction is already embedded in one
   *   of the trade txs (inline-tip mode). No separate tip tx is added and the
   *   fee-payer balance check is skipped.
   */
  private async submitBundle(tradeTxs: VersionedTransaction[], maxRetries = 5, tipInTxs = false): Promise<BundleResult> {
    let tipAccount: PublicKey | null = null;

    if (!tipInTxs) {
      tipAccount = await this.resolveTipAccount();

      // Verify fee payer can cover the tip before building the bundle
      const payerBalance = await this.connection.getBalance(this.payer.publicKey);
      const minRequired  = this.tipLamports + 5_000;
      if (payerBalance < minRequired) {
        throw new Error(
          `Fee payer ${this.payer.publicKey.toBase58()} has insufficient balance: ` +
          `${payerBalance} lamports < ${minRequired} required for tip + fee`,
        );
      }
    }

    const tradeBlockhash = tradeTxs[0].message.recentBlockhash;

    const b = new jitoBundle.Bundle([], MAX_BUNDLE_TXS);
    const b2 = b.addTransactions(...tradeTxs);
    if (b2 instanceof Error) throw b2;

    let finalBundle = b2;
    if (!tipInTxs) {
      const b3 = b2.addTipTx(this.payer, this.tipLamports, tipAccount!, tradeBlockhash);
      if (b3 instanceof Error) throw b3;
      finalBundle = b3;
    }

    const signatures = tradeTxs.map((tx) => bs58.encode(tx.signatures[0]));

    for (let i = 0; i < tradeTxs.length; i++) {
      const msg = tradeTxs[i].message;
      const txBytes = tradeTxs[i].serialize();
      console.log(
        `[JitoExecutor] tradeTx[${i}] blockhash:${msg.recentBlockhash}` +
        ` staticAccounts:${msg.staticAccountKeys.length}` +
        ` alts:${msg.addressTableLookups?.length ?? 0}` +
        ` reqSigs:${msg.header.numRequiredSignatures}` +
        ` sig:${bs58.encode(tradeTxs[i].signatures[0])}` +
        ` size:${txBytes.length}b`,
      );
      for (let j = 0; j < msg.compiledInstructions.length; j++) {
        const ix = msg.compiledInstructions[j];
        const prog = msg.staticAccountKeys[ix.programIdIndex].toBase58();
        console.log(`[JitoExecutor] tradeTx[${i}] ix[${j}] prog=${prog} accounts=${ix.accountKeyIndexes.length} data=${ix.data.length}b`);
      }
      console.log(`[JitoExecutor] tradeTx[${i}] b58=${bs58.encode(txBytes)}`);
    }

    // Inline-tip bundles use the REST sendBundle endpoint so we can isolate
    // whether the gRPC submission path (not the transactions themselves) is
    // causing the "Invalid" status. The REST endpoint is the same host we
    // already poll for getInflightBundleStatuses.
    if (tipInTxs) {
      console.log(
        `[JitoExecutor] submitBundle (REST): ${tradeTxs.length} tx(s) | inline tip | blockhash: ${tradeBlockhash}`,
      );
      return this.sendBundleViaRest(tradeTxs, signatures);
    }

    const tipDesc = `separate tip tx → ${tipAccount!.toBase58()} (${this.tipLamports} lamports)`;
    console.log(
      `[JitoExecutor] submitBundle (gRPC): ${tradeTxs.length} tx(s) | ${tipDesc} | blockhash: ${tradeBlockhash}`,
    );

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      const result = await this.searcherClient.sendBundle(finalBundle);

      if (result.ok) {
        console.log(`[JitoExecutor] Bundle submitted: ${result.value}`);
        return { bundleId: result.value, signatures };
      }

      const msg = result.error.message;
      const isRateLimited = msg.includes('rate limit') || msg.includes('Resource exhausted') || msg.includes('RESOURCE_EXHAUSTED');

      if (!isRateLimited || attempt === maxRetries) throw new Error(`gRPC sendBundle: ${msg}`);

      const delayMs = 1100 * (attempt + 1);
      console.warn(`[JitoExecutor] Rate limited — retrying in ${delayMs}ms (attempt ${attempt + 1}/${maxRetries})`);
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }

    throw new Error('Bundle submission failed after max retries');
  }

  /** Submit a bundle via the Jito REST JSON-RPC endpoint (same host as status polling). */
  private async sendBundleViaRest(tradeTxs: VersionedTransaction[], signatures: string[]): Promise<BundleResult> {
    const endpoint = `https://${this.blockEngineUrl}/api/v1/bundles`;
    const b58Txs = tradeTxs.map((tx) => bs58.encode(tx.serialize()));

    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'sendBundle',
        params: [b58Txs],
      }),
    });

    const text = await res.text();
    console.log(`[JitoExecutor] REST sendBundle HTTP ${res.status}:`, text);

    if (!res.ok) throw new Error(`REST sendBundle failed: HTTP ${res.status} — ${text}`);

    const json = JSON.parse(text);
    if (json.error) throw new Error(`REST sendBundle RPC error: ${JSON.stringify(json.error)}`);

    const bundleId = json.result as string;
    console.log(`[JitoExecutor] Bundle submitted (REST): ${bundleId}`);
    return { bundleId, signatures };
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