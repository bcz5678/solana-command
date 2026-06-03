import { Connection, Keypair, TransactionInstruction, TransactionMessage, VersionedTransaction, PublicKey } from '@solana/web3.js';
import BN from 'bn.js';
import {
  PUMP_SDK,
  OnlinePumpSdk,
  getBuyTokenAmountFromSolAmount,
  canonicalPumpPoolPda,
} from '@nirholas/pump-sdk';
import { TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID } from '@solana/spl-token';

export interface ExecuteResult {
  success: boolean;
  signature?: string;
  error?: string;
  solAmount: BN;
  tokenAmount: BN;
  price: number;
}

/**
 * Transaction executor — wraps the pump-fun-sdk offline instruction builders
 * with signing, simulation, and submission.
 *
 * Each bot instance gets its own Executor with its own wallet keypair.
 */
export class Executor {
  private readonly connection: Connection;
  private readonly onlineSdk: OnlinePumpSdk;
  private readonly wallet: Keypair;
  private readonly defaultSlippage: number;
  private readonly maxRetries: number;

  constructor(opts: {
    connection: Connection;
    wallet: Keypair;
    defaultSlippage?: number;
    maxRetries?: number;
  }) {
    this.connection = opts.connection;
    this.wallet = opts.wallet;
    this.defaultSlippage = opts.defaultSlippage ?? 0.05; // 5%
    this.maxRetries = opts.maxRetries ?? 2;
    this.onlineSdk = new OnlinePumpSdk(this.connection);
  }

  get publicKey(): PublicKey {
    return this.wallet.publicKey;
  }

  /** Buy tokens on the bonding curve */
  async buy(mint: PublicKey, solAmount: BN, slippage?: number): Promise<ExecuteResult> {
    const slip = slippage ?? this.defaultSlippage;
    try {
      // Check graduation and resolve token program once — neither changes mid-retry
      const [initialBuyState, tokenProgram] = await Promise.all([
        this.onlineSdk.fetchBuyState(mint, this.wallet.publicKey),
        this.resolveTokenProgram(mint),
      ]);

      if (initialBuyState.bondingCurve.complete) {
        return this.ammBuy(mint, solAmount, slippage);
      }

      // Mutable refs updated by the builder on each attempt
      let tokenAmount = new BN(0);
      let price = 0;

      const buildInstructions = async (): Promise<TransactionInstruction[]> => {
        const [buyState, global, feeConfig] = await Promise.all([
          this.onlineSdk.fetchBuyState(mint, this.wallet.publicKey),
          this.onlineSdk.fetchGlobal(),
          this.onlineSdk.fetchFeeConfig(),
        ]);

        const { bondingCurveAccountInfo, bondingCurve, associatedUserAccountInfo } = buyState;

        tokenAmount = getBuyTokenAmountFromSolAmount({
          global,
          feeConfig,
          mintSupply: bondingCurve.tokenTotalSupply,
          bondingCurve,
          amount: solAmount,
        });

        if (tokenAmount.isZero()) throw new Error('Zero token output');

        price = solAmount.toNumber() / tokenAmount.toNumber();

        return PUMP_SDK.buyInstructions({
          global,
          bondingCurveAccountInfo,
          bondingCurve,
          associatedUserAccountInfo,
          mint,
          user: this.wallet.publicKey,
          amount: tokenAmount,
          solAmount,
          slippage: slip * 100, // SDK expects percent (5 = 5%), not decimal (0.05)
          tokenProgram,
        });
      };

      const signature = await this.sendTransaction(buildInstructions);

      console.log(`BUY ${mint.toBase58().slice(0, 8)}… | ${(solAmount.toNumber() / 1e9).toFixed(4)} SOL → ${tokenAmount.toString()} tokens | sig=${signature.slice(0, 16)}…`);
      return { success: true, signature, solAmount, tokenAmount, price };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.log(`BUY FAILED ${mint.toBase58().slice(0, 8)}…: ${msg}`);
      return { success: false, error: msg, solAmount, tokenAmount: new BN(0), price: 0 };
    }
  }

  /** Sell tokens on the bonding curve */
  async sell(mint: PublicKey, tokenAmount?: BN, slippage?: number): Promise<ExecuteResult> {
    const slip = slippage ?? this.defaultSlippage;
    try {
      if (!tokenAmount) {
        return this.sellAll(mint, slippage);
      }

      const [initialSellState, tokenProgram] = await Promise.all([
        this.onlineSdk.fetchSellState(mint, this.wallet.publicKey),
        this.resolveTokenProgram(mint),
      ]);

      if (initialSellState.bondingCurve.complete) {
        return this.ammSell(mint, tokenAmount, slippage);
      }

      // sellChunked re-fetches state per chunk and splits automatically when
      // the amount would overflow the on-chain u64 multiply.
      const signatures = await this.onlineSdk.sellChunked({
        mint,
        user: this.wallet.publicKey,
        totalAmount: tokenAmount,
        slippage: slip * 100, // SDK expects percent (5 = 5%), not decimal (0.05)
        tokenProgram,
        sendTx: (ixs) => this.sendTransaction(() => Promise.resolve(ixs)),
      });

      const signature = signatures[signatures.length - 1];
      console.log(`SELL ${mint.toBase58().slice(0, 8)}… | ${tokenAmount.toString()} tokens | ${signatures.length} chunk(s) | sig=${signature.slice(0, 16)}…`);
      return { success: true, signature, solAmount: new BN(0), tokenAmount, price: 0 };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.log(`SELL FAILED ${mint.toBase58().slice(0, 8)}…: ${msg}`);
      return { success: false, error: msg, solAmount: new BN(0), tokenAmount: tokenAmount ?? new BN(0), price: 0 };
    }
  }

  /** Sell entire token balance */
  async sellAll(mint: PublicKey, slippage?: number): Promise<ExecuteResult> {
    try {
      const balance = await this.onlineSdk.getTokenBalance(mint, this.wallet.publicKey);
      if (balance.isZero()) {
        return { success: false, error: 'Zero balance', solAmount: new BN(0), tokenAmount: new BN(0), price: 0 };
      }

      const slip = slippage ?? this.defaultSlippage;
      const buildInstructions = () => this.onlineSdk.sellAllInstructions({
        mint,
        user: this.wallet.publicKey,
        slippage: slip * 100, // SDK expects percent (5 = 5%), not decimal (0.05)
      });

      const signature = await this.sendTransaction(buildInstructions);

      console.log(`SELL ALL ${mint.toBase58().slice(0, 8)}… | ${balance.toString()} tokens | sig=${signature.slice(0, 16)}…`);
      return { success: true, signature, solAmount: new BN(0), tokenAmount: balance, price: 0 };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.log(`SELL ALL FAILED ${mint.toBase58().slice(0, 8)}…: ${msg}`);
      return { success: false, error: msg, solAmount: new BN(0), tokenAmount: new BN(0), price: 0 };
    }
  }

  /** Buy on AMM (for graduated tokens) */
  private async ammBuy(mint: PublicKey, solAmount: BN, slippage?: number): Promise<ExecuteResult> {
    const slip = slippage ?? this.defaultSlippage;
    try {
      const poolPda = canonicalPumpPoolPda(mint);
      const minBaseOut = solAmount.muln(Math.floor((1 - slip) * 10000)).divn(10000);

      const buildInstructions = async () => [await PUMP_SDK.ammBuyExactQuoteInInstruction({
        user: this.wallet.publicKey,
        pool: poolPda,
        mint,
        quoteAmountIn: solAmount,
        minBaseAmountOut: minBaseOut,
      })];

      const signature = await this.sendTransaction(buildInstructions);
      console.log(`AMM BUY ${mint.toBase58().slice(0, 8)}… | ${(solAmount.toNumber() / 1e9).toFixed(4)} SOL | sig=${signature.slice(0, 16)}…`);
      return { success: true, signature, solAmount, tokenAmount: minBaseOut, price: 0 };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.log(`AMM BUY FAILED: ${msg}`);
      return { success: false, error: msg, solAmount, tokenAmount: new BN(0), price: 0 };
    }
  }

  /** Sell on AMM (for graduated tokens) */
  private async ammSell(mint: PublicKey, tokenAmount: BN, slippage?: number): Promise<ExecuteResult> {
    const slip = slippage ?? this.defaultSlippage;
    try {
      const poolPda = canonicalPumpPoolPda(mint);
      const minQuoteOut = new BN(0); // Accept any SOL amount (slippage applied in instruction)

      const buildInstructions = async () => [await PUMP_SDK.ammSellInstruction({
        user: this.wallet.publicKey,
        pool: poolPda,
        mint,
        baseAmountIn: tokenAmount,
        minQuoteAmountOut: minQuoteOut,
      })];

      const signature = await this.sendTransaction(buildInstructions);
      console.log(`AMM SELL ${mint.toBase58().slice(0, 8)}… | ${tokenAmount.toString()} tokens | sig=${signature.slice(0, 16)}…`);
      return { success: true, signature, solAmount: new BN(0), tokenAmount, price: 0 };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.log(`AMM SELL FAILED: ${msg}`);
      return { success: false, error: msg, solAmount: new BN(0), tokenAmount, price: 0 };
    }
  }

  /** Get SOL balance of the wallet */
  async getSolBalance(): Promise<BN> {
    const balance = await this.connection.getBalance(this.wallet.publicKey);
    return new BN(balance);
  }

  /** Get token balance for a mint */
  async getTokenBalance(mint: PublicKey): Promise<BN> {
    return this.onlineSdk.getTokenBalance(mint, this.wallet.publicKey);
  }

  /** Resolve the correct token program for a given mint by checking its on-chain owner */
  private async resolveTokenProgram(mint: PublicKey): Promise<PublicKey> {
    const info = await this.connection.getAccountInfo(mint);
    if (info && info.owner.equals(TOKEN_2022_PROGRAM_ID)) {
      return TOKEN_2022_PROGRAM_ID;
    }
    return TOKEN_PROGRAM_ID;
  }

  /**
   * Build, sign, and send a transaction with retry.
   * buildInstructions is called fresh on every attempt so each retry gets
   * up-to-date bonding curve state and a matching maxSolCost / minSolOut.
   */
  private async sendTransaction(
    buildInstructions: () => Promise<TransactionInstruction[]>
  ): Promise<string> {
    let lastError: Error | undefined;

    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      try {
        // Fetch fresh state and blockhash in parallel on every attempt
        const [instructions, { blockhash, lastValidBlockHeight }] = await Promise.all([
          buildInstructions(),
          this.connection.getLatestBlockhash('confirmed'),
        ]);

        const messageV0 = new TransactionMessage({
          payerKey: this.wallet.publicKey,
          recentBlockhash: blockhash,
          instructions,
        }).compileToV0Message();

        const tx = new VersionedTransaction(messageV0);
        tx.sign([this.wallet]);

        // skipPreflight: simulation runs against stale validator state and will
        // reject a valid blockhash or flag false slippage errors. On-chain
        // confirmation is the authoritative check.
        const signature = await this.connection.sendTransaction(tx, {
          skipPreflight: true,
          maxRetries: 0,
        });

        const confirmation = await this.connection.confirmTransaction(
          { signature, blockhash, lastValidBlockHeight },
          'confirmed'
        );

        if (confirmation.value.err) {
          throw new Error(`Transaction failed: ${JSON.stringify(confirmation.value.err)}`);
        }

        return signature;
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        if (attempt < this.maxRetries) {
          console.log(`TX attempt ${attempt + 1} failed: ${lastError.message} — retrying…`);
        }
      }
    }

    throw lastError ?? new Error('Transaction failed after retries');
  }
}
