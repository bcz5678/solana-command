import { Connection, Keypair, TransactionInstruction, TransactionMessage, VersionedTransaction, SystemProgram, PublicKey } from '@solana/web3.js';
import BN from 'bn.js';
import bs58 from 'bs58';
import type { Base64EncodedWireTransaction } from '@solana/kit';
import {
  PUMP_SDK,
  OnlinePumpSdk,
  getBuyTokenAmountFromSolAmount,
  getSellSolAmountFromTokenAmount,
} from '@nirholas/pump-sdk';

import { sendWithRetry, signInstructions } from '@/lib/trade/send-transaction';
import { resolveTokenProgram, getTokenBalance, getSolBalance } from '@/lib/trade/wallet-balance';
import { isBondingCurveActive } from '@/lib/trade/bonding-curve';
import { ExecuteResult } from '@/lib/trade/types';
import { QuicknodeJitoExecutor } from '@/lib/jito/clients/quicknode-jito-executor';

const ZERO = new BN(0);

/**
 * Bonding-curve-only executor — wraps pump-sdk's offline instruction builders
 * with signing, simulation, and submission. Pre-graduation buy/sell/sellAll
 * exclusively; callers are responsible for routing graduated mints (or mints
 * with no bonding curve at all) to a generic swap path instead — see the
 * dispatching `Executor` in lib/pumpfun/executor.ts.
 *
 * Each bot instance gets its own PumpfunExecutor with its own wallet keypair.
 */
export class PumpfunExecutor {
  private readonly connection: Connection;
  private readonly onlineSdk: OnlinePumpSdk;
  private readonly wallet: Keypair;
  private readonly defaultSlippage: number;
  private readonly maxRetries: number;
  private readonly dryRun: boolean;

  constructor(opts: {
    connection: Connection;
    wallet: Keypair;
    defaultSlippage?: number;
    maxRetries?: number;
    /** Sign and simulate every trade instead of broadcasting it. */
    dryRun?: boolean;
  }) {
    this.connection = opts.connection;
    this.wallet = opts.wallet;
    this.defaultSlippage = opts.defaultSlippage ?? 0.05; // 5%
    this.maxRetries = opts.maxRetries ?? 2;
    this.dryRun = opts.dryRun ?? false;
    this.onlineSdk = new OnlinePumpSdk(this.connection);
  }

  get publicKey(): PublicKey {
    return this.wallet.publicKey;
  }

  /** Shared by buy() and buyViaJito() — resolves fresh curve state and builds
   *  the raw buyInstructions() call. Pulled out so both send paths price
   *  against the same up-to-the-moment reserves instead of duplicating this. */
  private async buildBuyInstructions(
    mint: PublicKey,
    solAmount: BN,
    slip: number,
  ): Promise<{ instructions: TransactionInstruction[]; tokenAmount: BN; price: number }> {
    const tokenProgram = await resolveTokenProgram(this.connection, mint);

    const [buyState, global, feeConfig] = await Promise.all([
      this.onlineSdk.fetchBuyState(mint, this.wallet.publicKey),
      this.onlineSdk.fetchGlobal(),
      this.onlineSdk.fetchFeeConfig(),
    ]);

    const { bondingCurveAccountInfo, bondingCurve, associatedUserAccountInfo } = buyState;

    if (bondingCurve.complete) {
      throw new Error('Bonding curve has graduated — route this buy through the generic swap executor');
    }

    const tokenAmount = getBuyTokenAmountFromSolAmount({
      global,
      feeConfig,
      mintSupply: bondingCurve.tokenTotalSupply,
      bondingCurve,
      amount: solAmount,   // lamports
    });

    if (tokenAmount.isZero()) throw new Error('Zero token output');

    const price = solAmount.toNumber() / tokenAmount.toNumber();

    const instructions = await PUMP_SDK.buyInstructions({
      global,
      bondingCurveAccountInfo,
      bondingCurve,
      associatedUserAccountInfo,
      mint,
      user: this.wallet.publicKey,
      amount: tokenAmount,    // raw token units
      solAmount,              // lamports
      slippage: slip * 100,   // SDK expects percent (5 = 5%), not decimal (0.05)
      tokenProgram,
    });

    return { instructions, tokenAmount, price };
  }

  /** Buy tokens on the bonding curve. Throws if the curve has graduated. */
  async buy(mint: PublicKey, solAmount: BN, slippage?: number): Promise<ExecuteResult> {
    const slip = slippage ?? this.defaultSlippage;
    let tokenAmount = ZERO;
    let price = 0;
    try {
      const signature = await sendWithRetry(
        this.connection,
        async () => {
          const built = await this.buildBuyInstructions(mint, solAmount, slip);
          tokenAmount = built.tokenAmount;
          price = built.price;
          return signInstructions(this.connection, this.wallet, built.instructions);
        },
        this.maxRetries,
        this.dryRun,
      );
      console.log(`BUY ${mint.toBase58().slice(0, 8)}… | ${(solAmount.toNumber() / 1e9).toFixed(4)} SOL → ${tokenAmount.toString()} tokens | sig=${signature.slice(0, 16)}…`);
      return { success: true, signature, solAmount, tokenAmount, tokensRemaining: ZERO, price };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.log(`BUY FAILED ${mint.toBase58().slice(0, 8)}…: ${msg}`);
      return { success: false, error: msg, solAmount, tokenAmount: ZERO, tokensRemaining: ZERO, price: 0 };
    }
  }

  /**
   * Same buy, submitted as a solo Jito bundle (one transaction, its own tip)
   * instead of a plain sendTransaction. Bypasses the point where a sandwich
   * bot could see this wallet's transaction and react before it lands —
   * relevant for any sizable buy, not just at launch. Deliberately still one
   * wallet per bundle: bundling MULTIPLE wallets together is what actually
   * produces the "bundled wallets" signature screeners flag — a solo bundle,
   * staggered in time from the rest of the run like every other trade here,
   * doesn't create that co-occurrence signature at all.
   */
  async buyViaJito(mint: PublicKey, solAmount: BN, slippage: number | undefined, tipLamports: number): Promise<ExecuteResult> {
    const slip = slippage ?? this.defaultSlippage;
    try {
      const { instructions, tokenAmount, price } = await this.buildBuyInstructions(mint, solAmount, slip);

      const jitoExecutor = await QuicknodeJitoExecutor.create({
        endpoint:     process.env.SOLANA_RPC_URL!,
        tipLamports,
        simulateOnly: this.dryRun,
      });

      const [{ blockhash }, tipAccount] = await Promise.all([
        this.connection.getLatestBlockhash('confirmed'),
        jitoExecutor.getTipAccount(),
      ]);

      const finalIxs = [
        ...instructions,
        SystemProgram.transfer({
          fromPubkey: this.wallet.publicKey,
          toPubkey:   new PublicKey(tipAccount as string),
          lamports:   tipLamports,
        }),
      ];

      const message = new TransactionMessage({
        payerKey:        this.wallet.publicKey,
        recentBlockhash: blockhash,
        instructions:    finalIxs,
      }).compileToV0Message();

      const tx = new VersionedTransaction(message);
      tx.sign([this.wallet]);

      const encoded = Buffer.from(tx.serialize()).toString('base64') as Base64EncodedWireTransaction;
      const signature = bs58.encode(tx.signatures[0]);

      const result = await jitoExecutor.sendPrebuiltBundle([encoded], [this.wallet.publicKey.toBase58()]);
      console.log(`BUY (Jito) ${mint.toBase58().slice(0, 8)}… | ${(solAmount.toNumber() / 1e9).toFixed(4)} SOL → ${tokenAmount.toString()} tokens | sig=${signature.slice(0, 16)}… bundle=${result.bundleId || '(simulated)'}`);
      return { success: true, signature, solAmount, tokenAmount, tokensRemaining: ZERO, price };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.log(`BUY (Jito) FAILED ${mint.toBase58().slice(0, 8)}…: ${msg}`);
      return { success: false, error: msg, solAmount, tokenAmount: ZERO, tokensRemaining: ZERO, price: 0 };
    }
  }

  /** Sell a specific token amount on the bonding curve. Throws if the curve has graduated. */
  async sell(mint: PublicKey, tokenAmount?: BN, slippage?: number): Promise<ExecuteResult> {
    const slip = slippage ?? this.defaultSlippage;
    try {
      if (!tokenAmount) {
        return this.sellAll(mint, slippage);
      }

      const tokenProgram = await resolveTokenProgram(this.connection, mint);

      const buildInstructions = async (): Promise<TransactionInstruction[]> => {
        const [sellState, global, feeConfig] = await Promise.all([
          this.onlineSdk.fetchSellState(mint, this.wallet.publicKey),
          this.onlineSdk.fetchGlobal(),
          this.onlineSdk.fetchFeeConfig(),
        ]);

        const { bondingCurveAccountInfo, bondingCurve } = sellState;

        if (bondingCurve.complete) {
          throw new Error('Bonding curve has graduated — route this sell through the generic swap executor');
        }

        const solAmount = getSellSolAmountFromTokenAmount({
          global,
          feeConfig,
          mintSupply: bondingCurve.tokenTotalSupply,
          bondingCurve,
          amount: tokenAmount,
        });

        return PUMP_SDK.sellInstructions({
          global,
          bondingCurveAccountInfo,
          bondingCurve,
          mint,
          user: this.wallet.publicKey,
          amount: tokenAmount,
          solAmount,
          slippage: slip * 100,   // SDK expects percent (5 = 5%), not decimal
          tokenProgram,
        });
      };

      const signature = await sendWithRetry(
        this.connection,
        async () => signInstructions(this.connection, this.wallet, await buildInstructions()),
        this.maxRetries,
        this.dryRun,
      );
      console.log(`SELL ${mint.toBase58().slice(0, 8)}… | ${tokenAmount.toString()} tokens | sig=${signature.slice(0, 16)}…`);
      return { success: true, signature, solAmount: ZERO, tokenAmount, tokensRemaining: ZERO, price: 0 };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.log(`SELL FAILED ${mint.toBase58().slice(0, 8)}…: ${msg}`);
      return { success: false, error: msg, solAmount: ZERO, tokenAmount: ZERO, tokensRemaining: tokenAmount ?? ZERO, price: 0 };
    }
  }

  /** Sell entire bonding-curve token balance. Throws if the curve has graduated. */
  async sellAll(mint: PublicKey, slippage?: number, tokenProgram?: PublicKey): Promise<ExecuteResult> {
    try {
      const resolvedTokenProgram = tokenProgram ?? await resolveTokenProgram(this.connection, mint);
      const [balance, initialSellState] = await Promise.all([
        getTokenBalance(this.connection, mint, this.wallet.publicKey, resolvedTokenProgram),
        this.onlineSdk.fetchSellState(mint, this.wallet.publicKey),
      ]);

      if (balance.isZero()) {
        return { success: false, error: 'Zero balance', solAmount: ZERO, tokenAmount: ZERO, tokensRemaining: ZERO, price: 0 };
      }

      if (initialSellState.bondingCurve.complete) {
        throw new Error('Bonding curve has graduated — route this sell through the generic swap executor');
      }

      const slip = slippage ?? this.defaultSlippage;
      const buildInstructions = () => this.onlineSdk.sellAllInstructions({
        mint,
        user: this.wallet.publicKey,
        slippage: slip * 100,   // SDK expects percent (5 = 5%), not decimal
        tokenProgram: resolvedTokenProgram,
      });

      const signature = await sendWithRetry(
        this.connection,
        async () => signInstructions(this.connection, this.wallet, await buildInstructions()),
        this.maxRetries,
        this.dryRun,
      );
      console.log(`SELL ALL ${mint.toBase58().slice(0, 8)}… | ${balance.toString()} tokens | sig=${signature.slice(0, 16)}…`);
      return { success: true, signature, solAmount: ZERO, tokenAmount: balance, tokensRemaining: ZERO, price: 0 };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.log(`SELL ALL FAILED ${mint.toBase58().slice(0, 8)}…: ${msg}`);
      return { success: false, error: msg, solAmount: ZERO, tokenAmount: ZERO, tokensRemaining: ZERO, price: 0 };
    }
  }

  async getSolBalance(): Promise<BN> {
    return getSolBalance(this.connection, this.wallet.publicKey);
  }

  async getTokenBalance(mint: PublicKey): Promise<BN> {
    return getTokenBalance(this.connection, mint, this.wallet.publicKey);
  }

  /** True if `mint` has a live (non-graduated) pump.fun bonding curve. */
  async isBondingCurveActive(mint: PublicKey): Promise<boolean> {
    return isBondingCurveActive(this.connection, mint);
  }
}
