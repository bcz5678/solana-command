import { Connection, Keypair, TransactionInstruction, TransactionMessage, VersionedTransaction, PublicKey } from '@solana/web3.js';
import BN from 'bn.js';
import {
  PUMP_SDK,
  OnlinePumpSdk,
  getBuyTokenAmountFromSolAmount,
  getSellSolAmountFromTokenAmount,
} from '@nirholas/pump-sdk';
import { TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID } from '@solana/spl-token';

const ZERO = new BN(0);

export interface ExecuteResult {
  success: boolean;
  signature?: string;
  error?: string;
  solAmount: BN;
  tokenAmount: BN;        // raw token units sold (6 decimals for pump.fun tokens)
  tokensRemaining: BN;    // always ZERO — kept for API compatibility
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
      const [initialBuyState, tokenProgram] = await Promise.all([
        this.onlineSdk.fetchBuyState(mint, this.wallet.publicKey),
        this.resolveTokenProgram(mint),
      ]);

      if (initialBuyState.bondingCurve.complete) {
        return this.ammBuy(mint, solAmount, slippage);
      }

      let tokenAmount = ZERO;
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
          amount: solAmount,   // lamports
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
          amount: tokenAmount,    // raw token units
          solAmount,              // lamports
          slippage: slip * 100,   // SDK expects percent (5 = 5%), not decimal (0.05)
          tokenProgram,
        });
      };

      const signature = await this.sendTransaction(buildInstructions);
      console.log(`BUY ${mint.toBase58().slice(0, 8)}… | ${(solAmount.toNumber() / 1e9).toFixed(4)} SOL → ${tokenAmount.toString()} tokens | sig=${signature.slice(0, 16)}…`);
      return { success: true, signature, solAmount, tokenAmount, tokensRemaining: ZERO, price };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.log(`BUY FAILED ${mint.toBase58().slice(0, 8)}…: ${msg}`);
      return { success: false, error: msg, solAmount, tokenAmount: ZERO, tokensRemaining: ZERO, price: 0 };
    }
  }

  /** Sell a specific token amount on the bonding curve (or AMM if graduated) */
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

      const buildInstructions = async (): Promise<TransactionInstruction[]> => {
        const [sellState, global, feeConfig] = await Promise.all([
          this.onlineSdk.fetchSellState(mint, this.wallet.publicKey),
          this.onlineSdk.fetchGlobal(),
          this.onlineSdk.fetchFeeConfig(),
        ]);

        const { bondingCurveAccountInfo, bondingCurve } = sellState;

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

      const signature = await this.sendTransaction(buildInstructions);
      console.log(`SELL ${mint.toBase58().slice(0, 8)}… | ${tokenAmount.toString()} tokens | sig=${signature.slice(0, 16)}…`);
      return { success: true, signature, solAmount: ZERO, tokenAmount, tokensRemaining: ZERO, price: 0 };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.log(`SELL FAILED ${mint.toBase58().slice(0, 8)}…: ${msg}`);
      return { success: false, error: msg, solAmount: ZERO, tokenAmount: ZERO, tokensRemaining: tokenAmount ?? ZERO, price: 0 };
    }
  }

  /** Sell entire token balance (bonding curve or AMM) */
  async sellAll(mint: PublicKey, slippage?: number, tokenProgram?: PublicKey): Promise<ExecuteResult> {
    try {
      const resolvedTokenProgram = tokenProgram ?? await this.resolveTokenProgram(mint);
      const [balance, initialSellState] = await Promise.all([
        this.onlineSdk.getTokenBalance(mint, this.wallet.publicKey, resolvedTokenProgram),
        this.onlineSdk.fetchSellState(mint, this.wallet.publicKey),
      ]);

      if (balance.isZero()) {
        return { success: false, error: 'Zero balance', solAmount: ZERO, tokenAmount: ZERO, tokensRemaining: ZERO, price: 0 };
      }

      if (initialSellState.bondingCurve.complete) {
        return this.ammSell(mint, balance, slippage);
      }

      const slip = slippage ?? this.defaultSlippage;
      const buildInstructions = () => this.onlineSdk.sellAllInstructions({
        mint,
        user: this.wallet.publicKey,
        slippage: slip * 100,   // SDK expects percent (5 = 5%), not decimal
        tokenProgram: resolvedTokenProgram,
      });

      const signature = await this.sendTransaction(buildInstructions);
      console.log(`SELL ALL ${mint.toBase58().slice(0, 8)}… | ${balance.toString()} tokens | sig=${signature.slice(0, 16)}…`);
      return { success: true, signature, solAmount: ZERO, tokenAmount: balance, tokensRemaining: ZERO, price: 0 };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.log(`SELL ALL FAILED ${mint.toBase58().slice(0, 8)}…: ${msg}`);
      return { success: false, error: msg, solAmount: ZERO, tokenAmount: ZERO, tokensRemaining: ZERO, price: 0 };
    }
  }

  /** Buy on AMM (for graduated tokens) */
  private async ammBuy(mint: PublicKey, solAmount: BN, slippage?: number): Promise<ExecuteResult> {
    const slip = slippage ?? this.defaultSlippage;
    try {
      // ammBuyInstructions expects slippage as a decimal (0.05 = 5%)
      const buildInstructions = () => this.onlineSdk.ammBuyInstructions({
        mint,
        user: this.wallet.publicKey,
        solAmount,   // lamports
        slippage: slip,
      });

      const signature = await this.sendTransaction(buildInstructions);
      console.log(`AMM BUY ${mint.toBase58().slice(0, 8)}… | ${(solAmount.toNumber() / 1e9).toFixed(4)} SOL | sig=${signature.slice(0, 16)}…`);
      return { success: true, signature, solAmount, tokenAmount: ZERO, tokensRemaining: ZERO, price: 0 };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.log(`AMM BUY FAILED: ${msg}`);
      return { success: false, error: msg, solAmount, tokenAmount: ZERO, tokensRemaining: ZERO, price: 0 };
    }
  }

  /** Sell on AMM (for graduated tokens) */
  private async ammSell(mint: PublicKey, tokenAmount: BN, slippage?: number): Promise<ExecuteResult> {
    const slip = slippage ?? this.defaultSlippage;
    try {
      // ammSellInstructions expects slippage as a decimal (0.05 = 5%)
      const buildInstructions = () => this.onlineSdk.ammSellInstructions({
        mint,
        user: this.wallet.publicKey,
        tokenAmount,   // raw token units
        slippage: slip,
      });

      const signature = await this.sendTransaction(buildInstructions);
      console.log(`AMM SELL ${mint.toBase58().slice(0, 8)}… | ${tokenAmount.toString()} tokens | sig=${signature.slice(0, 16)}…`);
      return { success: true, signature, solAmount: ZERO, tokenAmount, tokensRemaining: ZERO, price: 0 };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.log(`AMM SELL FAILED: ${msg}`);
      return { success: false, error: msg, solAmount: ZERO, tokenAmount, tokensRemaining: ZERO, price: 0 };
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
   * buildInstructions is re-called on every attempt so each retry gets
   * fresh bonding-curve state and a matching maxSolCost / minSolOut.
   */
  private async sendTransaction(
    buildInstructions: () => Promise<TransactionInstruction[]>
  ): Promise<string> {
    let lastError: Error | undefined;

    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      try {
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

        // skipPreflight: simulation uses stale validator state and produces false
        // slippage / blockhash errors. On-chain confirmation is authoritative.
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
