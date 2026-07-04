import { Connection, Keypair, PublicKey } from '@solana/web3.js';
import BN from 'bn.js';

import { PumpfunExecutor } from './pumpfun-executor';
import { GenericSwapExecutor } from '@/lib/trade/generic-swap-executor';
import { getSolBalance, getTokenBalance } from '@/lib/trade/wallet-balance';
import { resolveTradeableMint } from '@/lib/trade/resolve-mint';
import { ExecuteResult } from '@/lib/trade/types';

const ZERO = new BN(0);

export type { ExecuteResult };

/**
 * Trade executor — routes a buy/sell to whichever backend actually applies:
 *  - PumpfunExecutor (pump-sdk bonding-curve instructions) while the mint has
 *    a live, non-graduated bonding curve.
 *  - GenericSwapExecutor (Jupiter) for graduated mints and any mint with no
 *    pump.fun bonding curve at all — this is what lets the app trade tokens
 *    that never touched pump.fun.
 *
 * Each bot instance gets its own Executor with its own wallet keypair.
 */
export class Executor {
  private readonly connection: Connection;
  private readonly wallet: Keypair;
  private readonly pumpfun: PumpfunExecutor;
  private readonly genericSwap: GenericSwapExecutor;

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
    this.pumpfun = new PumpfunExecutor(opts);
    this.genericSwap = new GenericSwapExecutor(opts);
  }

  get publicKey(): PublicKey {
    return this.wallet.publicKey;
  }

  /**
   * Buy `mint` — bonding curve if active, otherwise a generic (Jupiter) swap.
   * `mint` is resolved first in case it's actually a PumpSwap pool address
   * (trading partners sometimes hand those out instead of the real mint).
   */
  async buy(mint: PublicKey, solAmount: BN, slippage?: number): Promise<ExecuteResult> {
    let resolved: PublicKey;
    try {
      resolved = await resolveTradeableMint(this.connection, mint);
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      return { success: false, error, solAmount, tokenAmount: ZERO, tokensRemaining: ZERO, price: 0 };
    }

    return (await this.pumpfun.isBondingCurveActive(resolved))
      ? this.pumpfun.buy(resolved, solAmount, slippage)
      : this.genericSwap.buy(resolved, solAmount, slippage);
  }

  /** Sell `mint` — bonding curve if active, otherwise a generic (Jupiter) swap. */
  async sell(mint: PublicKey, tokenAmount?: BN, slippage?: number): Promise<ExecuteResult> {
    let resolved: PublicKey;
    try {
      resolved = await resolveTradeableMint(this.connection, mint);
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      return { success: false, error, solAmount: ZERO, tokenAmount: ZERO, tokensRemaining: tokenAmount ?? ZERO, price: 0 };
    }

    return (await this.pumpfun.isBondingCurveActive(resolved))
      ? this.pumpfun.sell(resolved, tokenAmount, slippage)
      : this.genericSwap.sell(resolved, tokenAmount, slippage);
  }

  /** Sell the wallet's entire balance of `mint`. */
  async sellAll(mint: PublicKey, slippage?: number): Promise<ExecuteResult> {
    let resolved: PublicKey;
    try {
      resolved = await resolveTradeableMint(this.connection, mint);
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      return { success: false, error, solAmount: ZERO, tokenAmount: ZERO, tokensRemaining: ZERO, price: 0 };
    }

    return (await this.pumpfun.isBondingCurveActive(resolved))
      ? this.pumpfun.sellAll(resolved, slippage)
      : this.genericSwap.sellAll(resolved, slippage);
  }

  /** Get SOL balance of the wallet */
  async getSolBalance(): Promise<BN> {
    return getSolBalance(this.connection, this.wallet.publicKey);
  }

  /** Get token balance for a mint */
  async getTokenBalance(mint: PublicKey): Promise<BN> {
    return getTokenBalance(this.connection, mint, this.wallet.publicKey);
  }
}
