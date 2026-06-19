import { Connection, Keypair, PublicKey, VersionedTransaction } from '@solana/web3.js'
import BN from 'bn.js'

import { getJupiterQuote, getJupiterSwapTransaction, WRAPPED_SOL_MINT } from './jupiter'
import { sendWithRetry } from './send-transaction'
import { getTokenBalance } from './wallet-balance'
import { ExecuteResult } from './types'

const ZERO = new BN(0)

/**
 * Generic SPL swap executor — routes through Jupiter instead of any single
 * protocol's pool instructions, so it works for graduated pump.fun tokens
 * and arbitrary SPL mints alike. Used as the fallback when a mint has no
 * active pump.fun bonding curve (see lib/pumpfun/executor.ts).
 */
export class GenericSwapExecutor {
  private readonly connection: Connection
  private readonly wallet: Keypair
  private readonly defaultSlippageBps: number
  private readonly maxRetries: number

  constructor(opts: {
    connection: Connection
    wallet: Keypair
    defaultSlippage?: number   // decimal, e.g. 0.05 = 5%
    maxRetries?: number
  }) {
    this.connection = opts.connection
    this.wallet = opts.wallet
    this.defaultSlippageBps = Math.round((opts.defaultSlippage ?? 0.05) * 10_000)
    this.maxRetries = opts.maxRetries ?? 2
  }

  get publicKey(): PublicKey {
    return this.wallet.publicKey
  }

  /** Buy `mint` by swapping SOL in via Jupiter. */
  async buy(mint: PublicKey, solAmount: BN, slippage?: number): Promise<ExecuteResult> {
    return this.swap('BUY', WRAPPED_SOL_MINT, mint.toBase58(), solAmount, slippage)
  }

  /** Sell a specific token amount of `mint` via Jupiter. */
  async sell(mint: PublicKey, tokenAmount?: BN, slippage?: number): Promise<ExecuteResult> {
    if (!tokenAmount) return this.sellAll(mint, slippage)
    return this.swap('SELL', mint.toBase58(), WRAPPED_SOL_MINT, tokenAmount, slippage)
  }

  /** Sell the wallet's entire balance of `mint` via Jupiter. */
  async sellAll(mint: PublicKey, slippage?: number): Promise<ExecuteResult> {
    const balance = await getTokenBalance(this.connection, mint, this.wallet.publicKey)
    if (balance.isZero()) {
      return { success: false, error: 'Zero balance', solAmount: ZERO, tokenAmount: ZERO, tokensRemaining: ZERO, price: 0 }
    }
    return this.swap('SELL', mint.toBase58(), WRAPPED_SOL_MINT, balance, slippage)
  }

  async getSolBalance(): Promise<BN> {
    const balance = await this.connection.getBalance(this.wallet.publicKey)
    return new BN(balance)
  }

  async getTokenBalance(mint: PublicKey): Promise<BN> {
    return getTokenBalance(this.connection, mint, this.wallet.publicKey)
  }

  private async swap(
    label: 'BUY' | 'SELL',
    inputMint: string,
    outputMint: string,
    amount: BN,
    slippage: number | undefined,
  ): Promise<ExecuteResult> {
    const slippageBps = slippage != null ? Math.round(slippage * 10_000) : this.defaultSlippageBps
    let outAmount = ZERO

    try {
      const signature = await sendWithRetry(this.connection, async () => {
        const quote = await getJupiterQuote(inputMint, outputMint, amount, slippageBps)
        outAmount = new BN(quote.outAmount)

        const { swapTransaction, lastValidBlockHeight } = await getJupiterSwapTransaction(
          quote,
          this.wallet.publicKey.toBase58(),
        )

        const tx = VersionedTransaction.deserialize(Buffer.from(swapTransaction, 'base64'))
        tx.sign([this.wallet])
        return { tx, blockhash: tx.message.recentBlockhash, lastValidBlockHeight }
      }, this.maxRetries)

      console.log(`JUP ${label} ${inputMint.slice(0, 8)}…→${outputMint.slice(0, 8)}… | in=${amount.toString()} out=${outAmount.toString()} | sig=${signature.slice(0, 16)}…`)

      return label === 'BUY'
        ? { success: true, signature, solAmount: amount, tokenAmount: outAmount, tokensRemaining: ZERO, price: amount.toNumber() / outAmount.toNumber() }
        : { success: true, signature, solAmount: outAmount, tokenAmount: amount, tokensRemaining: ZERO, price: 0 }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      console.log(`JUP ${label} FAILED: ${msg}`)

      return label === 'BUY'
        ? { success: false, error: msg, solAmount: amount, tokenAmount: ZERO, tokensRemaining: ZERO, price: 0 }
        : { success: false, error: msg, solAmount: ZERO, tokenAmount: ZERO, tokensRemaining: amount, price: 0 }
    }
  }
}
