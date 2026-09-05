// lib/trade/trending-volume-bot.ts
//
// TrendingVolumeBot: generates pump.fun trading volume by having each wallet
// in a pool round-trip — buy then immediately sell the exact amount just
// bought, both instructions in ONE atomic transaction, submitted as its own
// single-tx Jito bundle. Same non-blocking while-loop shape as HumanVolumeBot
// (lib/volume/human-volume.ts), driven by app/api/auto/trending/route.ts the
// same way HumanVolumeBot is driven by app/api/auto/human/route.ts.
//
// Deliberately ONE wallet per bundle, not multiple wallets packed into one
// Jito bundle (unlike bundle/buy's multi-wallet packing). bundle/buy's
// sequential curve simulation only ever chains consecutive BUYS within one
// bundle — chaining a SELL's effect on the curve into the next wallet's BUY
// has no proven implementation anywhere in this codebase, and getting that
// math wrong would silently sign transactions with wrong sell amounts. Each
// wallet instead fetches fresh on-chain curve state right before its own
// round-trip — buy-then-sell chaining WITHIN one wallet's own two
// instructions reuses the exact technique bundle/buy already proves correct
// (locally advance the curve after computing the buy, then price the sell
// against that advanced state) — just never chained across wallets.

import {
  Connection, Keypair, PublicKey, SystemProgram, TransactionInstruction,
  TransactionMessage, VersionedTransaction, Transaction, sendAndConfirmTransaction,
} from '@solana/web3.js'
import { TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID } from '@solana/spl-token'
import bs58 from 'bs58'
import {
  PUMP_SDK, OnlinePumpSdk, getBuyTokenAmountFromSolAmount, getSellSolAmountFromTokenAmount,
} from '@nirholas/pump-sdk'
import { getWalletKeypairById } from '@/lib/vault/get-wallet-by-id'
import { QuicknodeJitoExecutor } from '@/lib/jito/clients/quicknode-jito-executor'
import BN from 'bn.js'

export interface TrendingVolumeBotConfig {
  executor:   QuicknodeJitoExecutor
  connection: Connection
  tokenMint:  PublicKey
  fundingWallet: { id: string; publicKey: PublicKey }
  solAmountLamports: { min: BN; max: BN }     // per-wallet, per-round trade size
  jitoTipLamports?:    BN                     // default 0.0005 SOL — each round-trip is its own bundle, so this is paid every round
  slippage?:            number                // fraction, e.g. 0.1 = 10% — round trip needs headroom on both legs (bonding-curve path)
  ammSlippage?:          number                // AMM path's sell leg is priced against pre-buy reserves (see buildAmmRoundTripIxs) — needs more headroom, defaults wider than `slippage`
  totalRounds?:          number
  roundIntervalMs?:      number               // base delay between rounds
  roundJitterMs?:        number               // ± jitter on that delay
  walletsPerRoundMin?:   number                // not every wallet trades every round — same anti-clustering idea as comment auto-comment
  walletsPerRoundMax?:   number
  minWalletLamports?:    BN                    // top-up threshold
  txFeeBufferLamports?:  BN
  /** Simulate trade bundles and skip real top-up/consolidation transfers. */
  dryRun?: boolean
}

export type TrendingWalletState = 'IDLE' | 'TRADING'

export interface TrendingWalletRecord {
  id:               string
  publicKey:        PublicKey
  state:            TrendingWalletState
  roundsCompleted:  number
  roundsFailed:     number
  lastError:        string | null
}

function randomInRangeBN(min: BN, max: BN): BN {
  const span = max.sub(min)
  if (span.isZero()) return min
  // BN has no native random — scale a JS float into the span, fine at this precision for a trade-size roll.
  return min.add(new BN(Math.floor(Math.random() * (span.toNumber() + 1))))
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export class TrendingVolumeBot {
  private connection: Connection
  private executor:   QuicknodeJitoExecutor
  private onlineSdk:  OnlinePumpSdk
  private tokenMint:  PublicKey
  private fundingWallet: { id: string; publicKey: PublicKey }

  private solAmountLamports: { min: BN; max: BN }
  private jitoTipLamports:   BN
  private slippage:          number
  private ammSlippage:       number
  private totalRounds:       number
  private roundIntervalMs:   number
  private roundJitterMs:     number
  private walletsPerRoundMin: number
  private walletsPerRoundMax: number
  private minWalletLamports:   BN
  private txFeeBufferLamports: BN
  private dryRun: boolean

  private walletPool: TrendingWalletRecord[] = []
  private roundIndex = 0
  private landedRounds = 0
  private failedRounds = 0
  private volumeLamports = new BN(0)   // cumulative buy+sell notional across all landed round-trips

  private isLoopRunning = false

  constructor(config: TrendingVolumeBotConfig) {
    this.connection    = config.connection
    this.executor      = config.executor
    this.onlineSdk     = new OnlinePumpSdk(config.connection)
    this.tokenMint      = config.tokenMint
    this.fundingWallet  = config.fundingWallet
    this.solAmountLamports = config.solAmountLamports
    this.jitoTipLamports   = config.jitoTipLamports    ?? new BN(500_000)
    this.slippage           = config.slippage           ?? 0.10
    this.ammSlippage        = config.ammSlippage        ?? 0.15
    this.totalRounds        = config.totalRounds        ?? 1_000_000
    this.roundIntervalMs    = config.roundIntervalMs    ?? 8_000
    this.roundJitterMs      = config.roundJitterMs      ?? 3_000
    this.walletsPerRoundMin = config.walletsPerRoundMin ?? 1
    this.walletsPerRoundMax = config.walletsPerRoundMax ?? 3
    this.minWalletLamports   = config.minWalletLamports   ?? new BN(20_000_000)
    this.txFeeBufferLamports = config.txFeeBufferLamports ?? new BN(5_000)
    this.dryRun = config.dryRun ?? false
  }

  initializeWalletPool(walletsList: { id: string; publicKey: string }[]): void {
    this.walletPool = walletsList.map((w) => ({
      id:              w.id,
      publicKey:       new PublicKey(w.publicKey),
      state:           'IDLE',
      roundsCompleted: 0,
      roundsFailed:    0,
      lastError:       null,
    }))
  }

  get trendingLoopRunning(): boolean {
    return this.isLoopRunning
  }

  getStatus() {
    return {
      roundIndex:      this.roundIndex,
      landedRounds:    this.landedRounds,
      failedRounds:    this.failedRounds,
      volumeLamports:  this.volumeLamports.toString(),
      walletPool: this.walletPool.map((w) => ({
        id:              w.id,
        state:           w.state,
        roundsCompleted: w.roundsCompleted,
        roundsFailed:    w.roundsFailed,
        lastError:       w.lastError,
      })),
    }
  }

  async startTrendingLoop(): Promise<void> {
    if (this.isLoopRunning) {
      console.warn('TrendingVolumeBot: already running, ignoring startTrendingLoop()')
      return
    }
    this.isLoopRunning = true

    while (this.isLoopRunning && this.roundIndex < this.totalRounds) {
      await this.roundPass()
      await wait(this.randomInRangeMs(this.roundIntervalMs, this.roundJitterMs))
      this.roundIndex += 1
    }

    this.isLoopRunning = false
  }

  stopTrendingLoop(): void {
    if (!this.isLoopRunning) {
      console.warn('TrendingVolumeBot: not running, ignoring stopTrendingLoop()')
      return
    }
    this.isLoopRunning = false
  }

  /** Stops the loop and sweeps any leftover SOL in trading wallets back to the funding wallet — there are no held token positions to close, since every trade round-trips atomically. */
  async shutdown(): Promise<void> {
    this.isLoopRunning = false
    console.log('TrendingVolumeBot: Shutdown — consolidating leftover SOL')
    await Promise.all(this.walletPool.map((w) => this.consolidateSOL(w)))
    console.log('TrendingVolumeBot: Shutdown complete')
  }

  private randomInRangeMs(base: number, jitter: number): number {
    return Math.max(0, base - jitter + Math.floor(Math.random() * (2 * jitter + 1)))
  }

  private randomPercentInRangeInclusive(min: number, max: number): number {
    return Math.floor(Math.random() * (max - min + 1)) + min
  }

  private async roundPass(): Promise<void> {
    const idle = this.walletPool.filter((w) => w.state === 'IDLE')
    if (idle.length === 0) return

    const count = Math.min(idle.length, this.randomPercentInRangeInclusive(this.walletsPerRoundMin, this.walletsPerRoundMax))
    const shuffled = [...idle].sort(() => Math.random() - 0.5)
    const active = shuffled.slice(0, count)

    for (let i = 0; i < active.length; i++) {
      if (i > 0) await wait(this.randomPercentInRangeInclusive(500, 1_500))
      await this.executeRoundTrip(active[i])
    }
  }

  /**
   * Buy then immediately sell the full amount, both instructions in one
   * atomic transaction, submitted as its own single-tx Jito bundle. Branches
   * on graduation the same way lib/volume/human-volume.ts does — bonding
   * curve while live, PumpAMM (pump.fun's own post-migration AMM — NOT
   * Raydium, that was only the pre-PumpAMM migration target) once graduated.
   */
  private async executeRoundTrip(wallet: TrendingWalletRecord): Promise<boolean> {
    wallet.state = 'TRADING'
    let walletKeypair: Keypair | null = null

    const mint       = this.tokenMint
    const solAmount   = randomInRangeBN(this.solAmountLamports.min, this.solAmountLamports.max)

    let txSignature: string | null = null

    try {
      await this.checkAndTopUp(wallet, solAmount)

      // ── Fetch fresh on-chain state ────────────────────────────
      const [global, feeConfig, mintInfo, buyState, tipAccount, { blockhash }] = await Promise.all([
        this.onlineSdk.fetchGlobal(),
        this.onlineSdk.fetchFeeConfig(),
        this.connection.getAccountInfo(mint),
        this.onlineSdk.fetchBuyState(mint, wallet.publicKey),
        this.executor.getTipAccount(),
        this.connection.getLatestBlockhash('confirmed'),
      ])

      const tokenProgram = mintInfo?.owner.equals(TOKEN_2022_PROGRAM_ID)
        ? TOKEN_2022_PROGRAM_ID
        : TOKEN_PROGRAM_ID

      const { buyIxs, sellIxs, tokenAmount, sellSolAmount } = buyState.bondingCurve.complete
        ? await this.buildAmmRoundTripIxs(wallet, mint, solAmount)
        : await this.buildBondingCurveRoundTripIxs(wallet, mint, solAmount, global, feeConfig, tokenProgram, buyState)

      // ── Tip — paid by this wallet, since this round-trip is its own bundle ──
      const tipIx = SystemProgram.transfer({
        fromPubkey: wallet.publicKey,
        toPubkey:   new PublicKey(tipAccount as string),
        lamports:   this.jitoTipLamports.toNumber(),
      })

      const message = new TransactionMessage({
        payerKey:        wallet.publicKey,
        recentBlockhash: blockhash,
        instructions:    [...buyIxs, ...sellIxs, tipIx],
      }).compileToV0Message()

      walletKeypair = await getWalletKeypairById(wallet.id)
      const tx = new VersionedTransaction(message)
      tx.sign([walletKeypair])
      txSignature = bs58.encode(tx.signatures[0])

      const encoded = Buffer.from(tx.serialize()).toString('base64') as import('@solana/kit').Base64EncodedWireTransaction

      const { bundleId } = await this.executor.sendPrebuiltBundle([encoded], [wallet.publicKey.toBase58()])

      wallet.roundsCompleted += 1
      wallet.lastError = null
      this.landedRounds += 1
      this.volumeLamports = this.volumeLamports.add(solAmount).add(sellSolAmount)

      console.log(`[trending-volume] LANDED: wallet=${wallet.id} bundleId=${bundleId} buySol=${solAmount} sellSol=${sellSolAmount} tokens=${tokenAmount}`)
      return true

    } catch (err) {
      // Single-tx bundles land in ~400ms — the Jito inflight status can read
      // "Invalid" before our first poll even though the tx already landed.
      // Verify directly via Solana RPC signature status before counting this
      // as a real failure. Same recovery pattern as lib/volume/human-volume.ts.
      if (txSignature && err instanceof Error && err.message.includes('status: Invalid')) {
        for (let attempt = 0; attempt < 6; attempt++) {
          await wait(2_000)
          try {
            const { value: statuses } = await this.connection.getSignatureStatuses([txSignature])
            const s = statuses[0]
            if (s && !s.err && (s.confirmationStatus === 'confirmed' || s.confirmationStatus === 'finalized')) {
              wallet.roundsCompleted += 1
              wallet.lastError = null
              this.landedRounds += 1
              // sellSolAmount isn't in scope here (computed inside the try
              // block) — approximate with solAmount for the volume counter,
              // since actual sell proceeds land close to it minus fees/slippage.
              // Display-only figure, not used for any balance-critical logic.
              this.volumeLamports = this.volumeLamports.add(solAmount.muln(2))
              console.log(`[trending-volume] RECOVERED: wallet=${wallet.id} sig=${txSignature}`)
              return true
            }
          } catch { /* RPC hiccup — try again */ }
        }
      }

      const message = err instanceof Error ? err.message : String(err)
      wallet.roundsFailed += 1
      wallet.lastError = message
      this.failedRounds += 1
      console.error(`[trending-volume] FAILED: wallet=${wallet.id}`, message)
      return false
    } finally {
      wallet.state = 'IDLE'
      walletKeypair?.secretKey.fill(0)
    }
  }

  /**
   * Bonding-curve leg — locally advances the curve after the buy to price
   * the sell (same technique app/api/trade/bundle/buy/route.ts already uses
   * to chain consecutive buys, applied here to chain this wallet's own buy
   * into its own sell).
   */
  private async buildBondingCurveRoundTripIxs(
    wallet:       TrendingWalletRecord,
    mint:         PublicKey,
    solAmount:    BN,
    global:       Awaited<ReturnType<OnlinePumpSdk['fetchGlobal']>>,
    feeConfig:    Awaited<ReturnType<OnlinePumpSdk['fetchFeeConfig']>>,
    tokenProgram: PublicKey,
    buyState:     Awaited<ReturnType<OnlinePumpSdk['fetchBuyState']>>,
  ): Promise<{ buyIxs: TransactionInstruction[]; sellIxs: TransactionInstruction[]; tokenAmount: BN; sellSolAmount: BN }> {
    const { bondingCurveAccountInfo, bondingCurve, associatedUserAccountInfo } = buyState

    const tokenAmount = getBuyTokenAmountFromSolAmount({
      global, feeConfig,
      mintSupply:   bondingCurve.tokenTotalSupply,
      bondingCurve,
      amount:       solAmount,
    })
    if (tokenAmount.isZero()) throw new Error('Zero token output for buy leg')

    const buyIxs = await PUMP_SDK.buyInstructions({
      global, bondingCurveAccountInfo, bondingCurve, associatedUserAccountInfo,
      mint, user: wallet.publicKey,
      amount: tokenAmount, solAmount,
      slippage: this.slippage, tokenProgram,
    })

    // Advance the curve locally so the sell leg is priced against the
    // post-buy state, not the pre-buy state.
    const virtualSolCost = bondingCurve.virtualSolReserves
      .mul(tokenAmount)
      .div(bondingCurve.virtualTokenReserves.sub(tokenAmount))

    const postBuyCurve = {
      ...bondingCurve,
      virtualSolReserves:   bondingCurve.virtualSolReserves.add(virtualSolCost),
      virtualTokenReserves: bondingCurve.virtualTokenReserves.sub(tokenAmount),
      realTokenReserves:    bondingCurve.realTokenReserves.sub(tokenAmount),
      tokenTotalSupply:     bondingCurve.tokenTotalSupply.sub(tokenAmount),
    }

    const sellSolAmount = getSellSolAmountFromTokenAmount({
      global, feeConfig,
      mintSupply:   postBuyCurve.tokenTotalSupply,
      bondingCurve: postBuyCurve,
      amount:       tokenAmount,
    })

    const sellIxs = await PUMP_SDK.sellInstructions({
      global, bondingCurveAccountInfo, bondingCurve: postBuyCurve,
      mint, user: wallet.publicKey,
      amount: tokenAmount, solAmount: sellSolAmount,
      slippage: this.slippage, tokenProgram,
    })

    return { buyIxs, sellIxs, tokenAmount, sellSolAmount }
  }

  /**
   * PumpAMM leg (post-migration) — pump.fun's own AMM, not Raydium (Raydium
   * was only the pre-PumpAMM migration destination). Unlike the bonding
   * curve, ammQuoteBuy/ammQuoteSell always read LIVE on-chain reserves —
   * there's no reserve-override parameter exposed the way the bonding
   * curve's plain-object `bondingCurve` can be locally advanced, short of
   * pulling in @pump-fun/pump-swap-sdk directly and reimplementing its fee
   * math ourselves. So the sell leg's minimum-out is computed against
   * PRE-buy reserves while the buy will have already shifted them by the
   * time it actually executes — this wallet's own slippage tolerance is
   * what absorbs that gap, not curve chaining. A same-tx revert from
   * exceeding slippage just wastes the tip; Solana transactions are
   * all-or-nothing, so there's no risk of the buy landing without its sell.
   * Use a wider slippage than the bonding-curve path to account for this.
   */
  private async buildAmmRoundTripIxs(
    wallet:    TrendingWalletRecord,
    mint:      PublicKey,
    solAmount: BN,
  ): Promise<{ buyIxs: TransactionInstruction[]; sellIxs: TransactionInstruction[]; tokenAmount: BN; sellSolAmount: BN }> {
    const buyQuote = await this.onlineSdk.ammQuoteBuy({ mint, user: wallet.publicKey, quoteAmountIn: solAmount })
    if (buyQuote.tokensOut.isZero()) throw new Error('Zero token output for AMM buy leg')

    const [buyIxs, sellIxs, sellQuote] = await Promise.all([
      this.onlineSdk.ammBuyInstructions({ mint, user: wallet.publicKey, solAmount, slippage: this.ammSlippage }),
      this.onlineSdk.ammSellInstructions({ mint, user: wallet.publicKey, tokenAmount: buyQuote.tokensOut, slippage: this.ammSlippage }),
      this.onlineSdk.ammQuoteSell({ mint, user: wallet.publicKey, baseAmountIn: buyQuote.tokensOut }),
    ])

    return { buyIxs, sellIxs, tokenAmount: buyQuote.tokensOut, sellSolAmount: sellQuote.solOut }
  }

  private async getSOLBalanceLamports(wallet: TrendingWalletRecord): Promise<BN> {
    const lamports = await this.connection.getBalance(wallet.publicKey, 'confirmed')
    return new BN(lamports)
  }

  /**
   * Tops up to solAmount + tip + fee buffer + a minWalletLamports cushion.
   * Despite the sell leg returning most of solAmount within the same
   * transaction, Solana checks each instruction's balance sufficiency as it
   * executes — the buy instruction still needs the FULL solAmount present
   * before it runs, the sell only credits the wallet afterward. Unlike
   * HumanVolumeBot (separate buy/sell transactions, 2 tips) this is one tip
   * for the whole round-trip since both legs share a single bundle.
   */
  private async checkAndTopUp(wallet: TrendingWalletRecord, solAmount: BN): Promise<boolean> {
    const balance  = await this.getSOLBalanceLamports(wallet)
    const required = solAmount.add(this.jitoTipLamports).add(this.txFeeBufferLamports).add(this.minWalletLamports)
    if (balance.lt(required)) {
      const topUp = required.sub(balance)
      return this.sendLamports(this.fundingWallet.id, wallet, topUp)
    }
    return true
  }

  private async sendLamports(senderWalletId: string, receiver: TrendingWalletRecord, amountLamports: BN): Promise<boolean> {
    if (this.dryRun) {
      console.log(`[simulate] would transfer ${amountLamports.toString()} lamports: wallet=${senderWalletId} -> wallet=${receiver.id}`)
      return true
    }

    let senderKeypair: Keypair | null = null
    try {
      senderKeypair = await getWalletKeypairById(senderWalletId)
    } catch {
      return false
    }

    try {
      const { blockhash } = await this.connection.getLatestBlockhash('confirmed')
      const transaction = new Transaction()
      transaction.recentBlockhash = blockhash
      transaction.feePayer = senderKeypair.publicKey
      transaction.add(
        SystemProgram.transfer({
          fromPubkey: senderKeypair.publicKey,
          toPubkey:   receiver.publicKey,
          lamports:   amountLamports.toNumber(),
        }),
      )
      await sendAndConfirmTransaction(this.connection, transaction, [senderKeypair], { commitment: 'confirmed' })
      return true
    } catch {
      return false
    } finally {
      senderKeypair?.secretKey.fill(0)
    }
  }

  private async consolidateSOL(wallet: TrendingWalletRecord): Promise<void> {
    if (this.dryRun) {
      console.log(`[simulate] would consolidate SOL: wallet=${wallet.id} -> funding wallet=${this.fundingWallet.id}`)
      return
    }

    let walletKeypair: Keypair | null = null
    try {
      const balanceLamports = await this.getSOLBalanceLamports(wallet)
      const sendAmount = balanceLamports.sub(this.txFeeBufferLamports)
      if (!sendAmount.gtn(0)) return

      walletKeypair = await getWalletKeypairById(wallet.id)
      const { blockhash } = await this.connection.getLatestBlockhash('confirmed')
      const transaction = new Transaction()
      transaction.recentBlockhash = blockhash
      transaction.feePayer        = walletKeypair.publicKey
      transaction.add(
        SystemProgram.transfer({
          fromPubkey: walletKeypair.publicKey,
          toPubkey:   this.fundingWallet.publicKey,
          lamports:   sendAmount.toNumber(),
        }),
      )
      await sendAndConfirmTransaction(this.connection, transaction, [walletKeypair], { commitment: 'confirmed' })
      console.log(`[trending-volume] consolidated wallet=${wallet.id} sent ${sendAmount} lamports`)
    } catch (err) {
      console.error(`[trending-volume] consolidateSOL FAILED: wallet=${wallet.id}`, err)
    } finally {
      walletKeypair?.secretKey.fill(0)
    }
  }
}
