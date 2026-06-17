import { Connection, Keypair, PublicKey, SystemProgram, Transaction, TransactionInstruction, TransactionMessage, VersionedTransaction, sendAndConfirmTransaction } from "@solana/web3.js"
import { TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID, getAssociatedTokenAddressSync } from "@solana/spl-token"
import { PUMP_SDK, OnlinePumpSdk, getSellSolAmountFromTokenAmount, getBuyTokenAmountFromSolAmount } from "@nirholas/pump-sdk"
import { getWalletKeypairById } from "@/lib/vault/get-wallet-by-id";
import { QuicknodeJitoExecutor } from "@/lib/jito/clients/quicknode-jito-executor";
import BN from 'bn.js';





export interface HumanVolumeBotConfig {
    executor: QuicknodeJitoExecutor         // pre-built via QuicknodeJitoExecutor.create()
    connection: Connection                  // QuickNode RPC connection for balance checks
    buyAmountLamports: {min: BN, max: BN}   // per-wallet minimum buy amount in lamports       // per-wallet maximum buy amount in lamports
    sellPercent: {min: number, max: number}         // random portion of tokens to sell (looks organic)
    fundingWallet: { id: string; publicKey: PublicKey }  // vault UUID + public key of the master funding wallet
    tokenMint: PublicKey                    // target pump.fun token mint public key
    jitoTipLamports?: BN                    // tip per bundle in lamports (default 1_000_000 = 0.001 SOL)
    totalCycles?: number                    // defaults to 1_000_000 (runs until stopped)
    minHoldCycles?: number                  // wallet must survive at least N cycles before eligible to sell
    maxHoldCycles?: number                  // force sell if wallet has held this many cycles
    cycleIntervalMs?: number                // base delay between bundles
    cycleJitterMs?: number                  // ± random jitter added to each interval
    minWalletLamports?: BN                  // top-up threshold in lamports (default 20_000_000 = 0.02 SOL)
    txFeeBufferLamports?: BN               // Transfer fee in Lamports to use in SOL transfer
    maxSellTranches?: number               // max partial sells before forcing 100% exit (default 3)
}

export interface WalletRecord {
      id:              string           // wallet UUID identifier
      publicKey:       PublicKey
      state:           'IDLE' | 'BUYING' | 'HOLDING' | 'HOLDING_PORTION' | 'SELLING'
      tokenBalanceRaw: BN               // raw token units (pump.fun base units, 6 decimals)
      lamportsSpent:   BN               // lamports spent on the buy
      boughtAtCycle:   number | null    // cycle index when position was opened
      holdCycles:      number | null    // how many cycles this wallet has held
      sellTranches:    number           // how many partial sells have been executed on this position
    }

interface VolumeLoopOptions<T = void> {

  /** Called on every tick while the loop is active. */
  onTick: (state: T) => void | Promise<void>;

  /**
   * Called before each tick to decide whether to continue.
   * Return `false` to exit the loop naturally.
   * Defaults to () => true (runs forever until stopRunLoop).
   */
  condition?: (state: T) => boolean;

  /** Called once after the loop exits (from stop or condition). */
  onStop?: (state: T) => void;

  /**
   * Delay (ms) between ticks. Defaults to 0 (next event loop turn).
   * Use higher values for throttled loops (e.g. polling every 500ms).
   */
  tickDelay?: number;

  /** Optional shared state object mutated/read across ticks. */
  state?: T;
}


export class HumanVolumeBot<T = void> {
    private connection: Connection
    private buyAmountLamports: {min: BN, max: BN}
    private sellPercent: {min: number, max: number}
    private fundingWallet: { id: string; publicKey: PublicKey }
    private tokenMint: PublicKey
    private jitoTipLamports: BN
    private minHoldCycles: number
    private maxHoldCycles: number
    private totalCycles: number
    private cycleIntervalMs: number
    private cycleJitterMs: number
    private minWalletLamports: BN
    private txFeeBufferLamports: BN
    private maxSellTranches: number

    private walletPool: WalletRecord[]

    private isVolumeLoopRunning: boolean
    private volumeLoopOptions: Required<VolumeLoopOptions<T>>;
    private cycleIndex: number

    private executor: QuicknodeJitoExecutor
    private onlineSdk: OnlinePumpSdk


     constructor(config: HumanVolumeBotConfig) {
        const {
            executor,
            connection,
            buyAmountLamports,
            sellPercent,
            fundingWallet,
            tokenMint,
            jitoTipLamports,
            totalCycles,
            minHoldCycles,
            maxHoldCycles,
            cycleIntervalMs,
            cycleJitterMs,
            minWalletLamports,
            txFeeBufferLamports,
            maxSellTranches,
        } = config

        this.connection = connection;
        this.buyAmountLamports = buyAmountLamports;
        this.sellPercent = sellPercent;
        this.fundingWallet = fundingWallet;
        this.tokenMint = tokenMint;
        this.jitoTipLamports = jitoTipLamports ?? new BN(1_000_000);
        this.totalCycles = totalCycles ?? 1_000_000;
        this.minHoldCycles = minHoldCycles ?? 2;
        this.maxHoldCycles = maxHoldCycles ?? 8;
        this.cycleIntervalMs = cycleIntervalMs ?? 6_000;
        this.cycleJitterMs = cycleJitterMs ?? 2_000;
        this.minWalletLamports = minWalletLamports ?? new BN(20_000_000);
        this.txFeeBufferLamports = txFeeBufferLamports ?? new BN(5_000);
        this.maxSellTranches = maxSellTranches ?? 3;

        this.executor  = executor;
        this.onlineSdk = new OnlinePumpSdk(connection);
        this.walletPool = []

        // VolumeLoop Properties
        this.cycleIndex = 0;
        this.isVolumeLoopRunning = false;
        this.volumeLoopOptions = {
            onTick: () => this.volumeLoopPass(),
            condition: () => (this.cycleIndex < this.totalCycles),
            onStop: () => {},
            tickDelay: 0,
            state: undefined as T,
        };

    }

    // ─── Private Helpers ───────────────────────────────────────

    /**
     * Yields control back to the JS event loop.
     * This is what makes the while loop non-blocking —
     * other microtasks/macrotasks get to run between ticks.
     */
    private yield(): Promise<void> {
        return new Promise((resolve) =>
            this.volumeLoopOptions.tickDelay > 0
                ? setTimeout(resolve, this.volumeLoopOptions.tickDelay)
                : setTimeout(resolve, 0)
        )
    }


    // ─── Public API ────────────────────────────────────────────

    initializeWalletPool(walletsList: {id: string, publicKey: string}[] ) {
        this.walletPool = []

        walletsList.forEach((wallet) => {
            this.walletPool.push({
                id:              wallet.id,
                publicKey:       new PublicKey(wallet.publicKey),
                state:           'IDLE',
                tokenBalanceRaw: new BN(0),
                lamportsSpent:   new BN(0),
                boughtAtCycle:   null,
                holdCycles:      null,
                sellTranches:    0,
            });
        });
    }


    async volumeLoopPass(): Promise<void> {
        // ── STEP 1: Check if any HOLDING or HOLDING_PORTION wallet should exit ─

        let holdingWallets: WalletRecord[] = this.walletPool.filter(w => w.state === 'HOLDING' || w.state === 'HOLDING_PORTION');
        let sellCandidate: WalletRecord | null = this.selectSellCandidate(holdingWallets);

        if (sellCandidate != null) {
            await this.submitSellBundle(sellCandidate);
        }

        // ── STEP 2: Select next IDLE wallet to buy ───────────────────────────
        // Exclude the wallet that just sold — prevents same-cycle sell+rebuy
        const justSoldId = sellCandidate?.id ?? null
        let idleWallets: WalletRecord[] = this.walletPool.filter(w => w.state === 'IDLE' && w.id !== justSoldId);
        let buyCandidate: WalletRecord | null = this.selectBuyCandidate(idleWallets);

        if(buyCandidate != null) {
            await this.checkAndTopUp(buyCandidate)
            await this.submitBuyBundle(buyCandidate)
            // marks wallet state = HOLDING
        }
            
        // ── STEP 3: Increment hold counters on all HOLDING / HOLDING_PORTION wallets

        this.walletPool
            .filter(wallet => wallet.state === 'HOLDING' || wallet.state === 'HOLDING_PORTION')
            .forEach((wallet) => {
                wallet.holdCycles = (wallet.holdCycles ?? 0) + 1
        });

        // ── STEP 4: Wait before next cycle (with jitter) ─────────────────────

        const delay = this.cycleIntervalMs - this.cycleJitterMs + Math.floor(Math.random() * (2 * this.cycleJitterMs + 1))
        await new Promise((resolve) => setTimeout(resolve, delay))

        this.cycleIndex += 1      
    }

    /**
     * Starts the runVolumeLoop asynchronously.
     * Returns a Promise that resolves when the loop exits.
     * Safe to call with `void` if you don't need to await it.
     */
    async startVolumeLoop(): Promise<void> {
        if (this.isVolumeLoopRunning) {
            console.warn("HumanVolumeBot: already running, ignoring startVolumeLoop()");
            return;
        }

        this.isVolumeLoopRunning= true;

        const { onTick, condition, onStop, state } = this.volumeLoopOptions;

        // ── Non-blocking while loop ──────────────────────────────
        // Each iteration:
        //  1. Checks both the stop signal (isRunning) and the user condition
        //  2. Runs onTick (which may be async)
        //  3. Yields via await so the event loop can breathe
        while (this.isVolumeLoopRunning && condition(state)) {
            await onTick(state);  // await supports both sync and async onTick
            await this.yield();   // ← the non-blocking heart of the loop
        }

        // Loop exited — either stopRunLoop() was called or condition() returned false
        this.isVolumeLoopRunning = false;
        onStop(state);
    }

    /**
     * Signals the loop to stop after the current tick completes.
     * Non-destructive — the loop exits cleanly on the next iteration check.
     */
    stopVolumeLoop(): void {
        if (!this.isVolumeLoopRunning) {
            console.warn("HumanVolumeBot: not running, ignoring stopVolumeLoop()");
            return;
        }
        this.isVolumeLoopRunning = false; // checked at top of while loop → exits next cycle
    }

    /** Returns whether the loop is currently active. */
    get volumeLoopRunning(): boolean {
        return this.isVolumeLoopRunning;
    }

    /** Snapshot of current bot state for status reporting. */
    getStatus() {
        return {
            cycleIndex: this.cycleIndex,
            walletPool: this.walletPool.map(w => ({
                id:              w.id,
                state:           w.state,
                holdCycles:      w.holdCycles,
                sellTranches:    w.sellTranches,
                tokenBalanceRaw: w.tokenBalanceRaw.toString(),
                lamportsSpent:   w.lamportsSpent.toString(),
                boughtAtCycle:   w.boughtAtCycle,
            })),
        }
    }

    selectSellCandidate(holdingWallets: WalletRecord[]): WalletRecord | null {
        // HOLDING_PORTION wallets are always highest priority — open remainder, must exit
        const portionWallets = holdingWallets.filter(w => w.state === 'HOLDING_PORTION')
        if (portionWallets.length > 0) {
            return this.randomPick(portionWallets)
        }

        // Force-exit any HOLDING wallet that has held too long
        const overdue = holdingWallets
            .filter(w => w.state === 'HOLDING' && (w.holdCycles ?? 0) >= this.maxHoldCycles)
            .sort((a, b) => (b.holdCycles ?? 0) - (a.holdCycles ?? 0))

        if (overdue.length > 0) {
            return overdue[0]
        }

        // Otherwise only sell if at least minHoldCycles have passed
        const eligible = holdingWallets.filter(w => w.state === 'HOLDING' && (w.holdCycles ?? 0) >= this.minHoldCycles)

        if (eligible.length === 0) {
            return null
        }

        return this.randomPick(eligible)
    }

    selectBuyCandidate(idleWallets: WalletRecord[]): WalletRecord | null {   
        if (idleWallets.length == 0) {
            // ALl wallets are holding - skip this buy cycle
            return null;
        }
        // Pick randomly (not FIFO) so wallet sequence is unpredictable on-chain
        return this.randomPick(idleWallets); 
    }

    async submitSellBundle(wallet: WalletRecord, forceFullExit = false): Promise<boolean> {
        const prevState = wallet.state
        wallet.state = 'SELLING'
        let walletKeypair: Keypair | null = null

        try {
            // ── Step 1: Read actual on-chain token balance ────────────────────
            const mint = this.tokenMint
            const ata  = getAssociatedTokenAddressSync(mint, wallet.publicKey)

            let actualBalanceRaw: BN
            try {
                const resp = await this.connection.getTokenAccountBalance(ata, 'confirmed')
                actualBalanceRaw = new BN(resp.value.amount)
            } catch {
                actualBalanceRaw = new BN(0)
            }

            if (actualBalanceRaw.isZero()) {
                wallet.state           = 'IDLE'
                wallet.tokenBalanceRaw = new BN(0)
                return true
            }

            // ── Step 2: Determine sell amount ─────────────────────────────────
            // Force 100% on the final tranche so positions always fully exit
            const isLastTranche = forceFullExit || wallet.sellTranches >= this.maxSellTranches - 1
            const sellPercent   = isLastTranche
                ? 100
                : this.randomPercentInRangeInclusive(this.sellPercent.min, this.sellPercent.max)
            const sellAmount  = actualBalanceRaw.muln(sellPercent).divn(100)
            const slippage    = this.randomPercentInRangeInclusive(5, 15)

            // ── Step 3: Fetch on-chain state and tip account in parallel ──────
            const [global, feeConfig, mintInfo, sellState, tipAccount, { blockhash }] = await Promise.all([
                this.onlineSdk.fetchGlobal(),
                this.onlineSdk.fetchFeeConfig(),
                this.connection.getAccountInfo(mint),
                this.onlineSdk.fetchSellState(mint, wallet.publicKey),
                this.executor.getTipAccount(),
                this.connection.getLatestBlockhash('confirmed'),
            ])

            // ── Step 4: Build trade instructions (bonding curve or AMM) ──────
            let tradeIxs: TransactionInstruction[]

            if (sellState.bondingCurve.complete) {
                tradeIxs = await this.onlineSdk.ammSellInstructions({
                    mint,
                    user:        wallet.publicKey,
                    tokenAmount: sellAmount,
                    slippage:    slippage / 100,
                })
            } else {
                const tokenProgram = mintInfo?.owner.equals(TOKEN_2022_PROGRAM_ID)
                    ? TOKEN_2022_PROGRAM_ID
                    : TOKEN_PROGRAM_ID

                const solExpected = getSellSolAmountFromTokenAmount({
                    global,
                    feeConfig,
                    mintSupply:   sellState.bondingCurve.tokenTotalSupply,
                    bondingCurve: sellState.bondingCurve,
                    amount:       sellAmount,
                })

                tradeIxs = await PUMP_SDK.sellInstructions({
                    global,
                    bondingCurveAccountInfo: sellState.bondingCurveAccountInfo,
                    bondingCurve:            sellState.bondingCurve,
                    mint,
                    user:      wallet.publicKey,
                    amount:    sellAmount,
                    solAmount: solExpected,
                    slippage,
                    tokenProgram,
                })
            }

            const tipIx = SystemProgram.transfer({
                fromPubkey: wallet.publicKey,
                toPubkey:   new PublicKey(tipAccount as string),
                lamports:   this.jitoTipLamports.toNumber(),
            })

            // ── Step 5: Build transaction message ────────────────────────────
            const message = new TransactionMessage({
                payerKey:        wallet.publicKey,
                recentBlockhash: blockhash,
                instructions:    [...tradeIxs, tipIx],
            }).compileToV0Message()

            // ── Step 6: Fetch keypair and sign (secret key minimally exposed) ─
            walletKeypair = await getWalletKeypairById(wallet.id)
            const tx = new VersionedTransaction(message)
            tx.sign([walletKeypair])

            const encoded = Buffer.from(tx.serialize()).toString('base64') as import('@solana/kit').Base64EncodedWireTransaction

            // ── Step 7: Submit as single-tx Jito bundle ───────────────────────
            const { bundleId } = await this.executor.sendPrebuiltBundle([encoded], [wallet.publicKey.toBase58()])

            // ── Step 8: Update wallet state ───────────────────────────────────
            const remaining        = actualBalanceRaw.sub(sellAmount)
            wallet.tokenBalanceRaw = remaining

            if (remaining.isZero()) {
                wallet.state        = 'IDLE'
                wallet.holdCycles   = null
                wallet.sellTranches = 0
            } else {
                wallet.state        = 'HOLDING_PORTION'
                wallet.holdCycles   = 0
                wallet.sellTranches = wallet.sellTranches + 1
            }

            console.log(`[submitSellBundle] LANDED: wallet=${wallet.id} bundleId=${bundleId} tranche=${wallet.sellTranches} sold=${sellAmount} remaining=${remaining}`)
            return true

        } catch (err) {
            wallet.state = prevState
            console.error(`[submitSellBundle] FAILED: wallet=${wallet.id}`, err)
            return false
        } finally {
            walletKeypair?.secretKey.fill(0)
        }
    }

    async submitBuyBundle(wallet: WalletRecord): Promise<boolean> {
        wallet.state = 'BUYING'
        let walletKeypair: Keypair | null = null

        try {
            const mint      = this.tokenMint
            const solAmount = new BN(
                Math.floor(Math.random() * (this.buyAmountLamports.max.toNumber() - this.buyAmountLamports.min.toNumber() + 1))
                + this.buyAmountLamports.min.toNumber()
            )
            const slippage = this.randomPercentInRangeInclusive(5, 15)

            // ── Step 1: Fetch on-chain state and tip account in parallel ──────
            const [global, feeConfig, mintInfo, buyState, tipAccount, { blockhash }] = await Promise.all([
                this.onlineSdk.fetchGlobal(),
                this.onlineSdk.fetchFeeConfig(),
                this.connection.getAccountInfo(mint),
                this.onlineSdk.fetchBuyState(mint, wallet.publicKey),
                this.executor.getTipAccount(),
                this.connection.getLatestBlockhash('confirmed'),
            ])

            // ── Step 2: Build trade instructions (bonding curve or AMM) ──────
            let tokenAmount = new BN(0)
            let tradeIxs: TransactionInstruction[]

            if (buyState.bondingCurve.complete) {
                tradeIxs = await this.onlineSdk.ammBuyInstructions({
                    mint,
                    user:     wallet.publicKey,
                    solAmount,
                    slippage: slippage / 100,
                })
            } else {
                const tokenProgram = mintInfo?.owner.equals(TOKEN_2022_PROGRAM_ID)
                    ? TOKEN_2022_PROGRAM_ID
                    : TOKEN_PROGRAM_ID

                tokenAmount = getBuyTokenAmountFromSolAmount({
                    global,
                    feeConfig,
                    mintSupply:   buyState.bondingCurve.tokenTotalSupply,
                    bondingCurve: buyState.bondingCurve,
                    amount:       solAmount,
                })

                if (tokenAmount.isZero()) {
                    throw new Error(`Zero token output for wallet ${wallet.id}`)
                }

                tradeIxs = await PUMP_SDK.buyInstructions({
                    global,
                    bondingCurveAccountInfo:   buyState.bondingCurveAccountInfo,
                    bondingCurve:              buyState.bondingCurve,
                    associatedUserAccountInfo: buyState.associatedUserAccountInfo,
                    mint,
                    user:     wallet.publicKey,
                    amount:   tokenAmount,
                    solAmount,
                    slippage,
                    tokenProgram,
                })
            }

            const tipIx = SystemProgram.transfer({
                fromPubkey: wallet.publicKey,
                toPubkey:   new PublicKey(tipAccount as string),
                lamports:   this.jitoTipLamports.toNumber(),
            })

            // ── Step 3: Build transaction message ────────────────────────────
            const message = new TransactionMessage({
                payerKey:        wallet.publicKey,
                recentBlockhash: blockhash,
                instructions:    [...tradeIxs, tipIx],
            }).compileToV0Message()

            // ── Step 4: Fetch keypair and sign (secret key minimally exposed) ─
            walletKeypair = await getWalletKeypairById(wallet.id)
            const tx = new VersionedTransaction(message)
            tx.sign([walletKeypair])

            const encoded = Buffer.from(tx.serialize()).toString('base64') as import('@solana/kit').Base64EncodedWireTransaction

            // ── Step 5: Submit as single-tx Jito bundle ───────────────────────
            const { bundleId } = await this.executor.sendPrebuiltBundle([encoded], [wallet.publicKey.toBase58()])

            // ── Step 6: Update wallet state ───────────────────────────────────
            if (buyState.bondingCurve.complete) {
                // AMM path: tokenAmount was not calculated — read actual on-chain balance
                try {
                    const ata  = getAssociatedTokenAddressSync(mint, wallet.publicKey)
                    const resp = await this.connection.getTokenAccountBalance(ata, 'confirmed')
                    wallet.tokenBalanceRaw = new BN(resp.value.amount)
                } catch {
                    wallet.tokenBalanceRaw = new BN(0)
                }
            } else {
                wallet.tokenBalanceRaw = tokenAmount
            }
            wallet.state         = 'HOLDING'
            wallet.lamportsSpent = solAmount
            wallet.boughtAtCycle = this.cycleIndex
            wallet.holdCycles    = 0

            console.log(`[submitBuyBundle] LANDED: wallet=${wallet.id} bundleId=${bundleId} tokens=${wallet.tokenBalanceRaw} lamports=${solAmount}`)
            return true

        } catch (err) {
            wallet.state = 'IDLE'
            console.error(`[submitBuyBundle] FAILED: wallet=${wallet.id}`, err)
            return false
        } finally {
            walletKeypair?.secretKey.fill(0)
        }
    }

    private async getSOLBalanceLamports(wallet: WalletRecord): Promise<BN> {
        const lamports = await this.connection.getBalance(wallet.publicKey, 'confirmed')
        return new BN(lamports)
    }

    async checkAndTopUp(wallet: WalletRecord): Promise<boolean> {
        const balance = await this.getSOLBalanceLamports(wallet)
        if (balance.lt(this.minWalletLamports)) {
            const lamportsNeeded = this.buyAmountLamports.max.add(this.jitoTipLamports).add(this.txFeeBufferLamports).sub(balance)
            return this.sendLamports(this.fundingWallet.id, wallet, lamportsNeeded)
        }
        return true
    }

    randomPick(eligibleWallets: WalletRecord[]): WalletRecord {
        return (eligibleWallets[Math.floor(Math.random() * eligibleWallets.length)]);
    }

    randomPercentInRangeInclusive(min: number, max: number): number {
        return Math.floor(Math.random() * (max - min + 1)) + min;
    }

    async sendLamports(senderWalletId: string, receiver: WalletRecord, amountLamports: BN): Promise<boolean> {
    
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
                })
            )

            await sendAndConfirmTransaction(this.connection, transaction, [senderKeypair], { commitment: 'confirmed' })

            return true
        } catch {
            return false
        } finally {
            senderKeypair?.secretKey.fill(0)
        }
    }

    async consolidateSOL(wallet: WalletRecord): Promise<void> {
        let walletKeypair: Keypair | null = null

        try {
            // Check trade wallet has enough to be worth sending
            const balanceLamports = await this.getSOLBalanceLamports(wallet)
            const sendAmount = balanceLamports.sub(this.txFeeBufferLamports)

            if (!sendAmount.gtn(0)) {
                console.log(`[consolidateSOL] wallet=${wallet.id} balance too low to consolidate`)
                return
            }

            // Fetch trade wallet keypair to sign the transfer
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
                })
            )

            await sendAndConfirmTransaction(this.connection, transaction, [walletKeypair], { commitment: 'confirmed' })
            console.log(`[consolidateSOL] wallet=${wallet.id} sent ${sendAmount} lamports to funding wallet`)

        } catch (err) {
            console.error(`[consolidateSOL] FAILED: wallet=${wallet.id}`, err)
        } finally {
            walletKeypair?.secretKey.fill(0)
        }
    }

    async shutdown(): Promise<void> {
        console.log("HumanVolumeBot: Shutdown initiated — draining all positions")

        const toSell = this.walletPool.filter(
            w => w.state === 'HOLDING' || w.state === 'HOLDING_PORTION' || w.state === 'SELLING'
        )

        // First pass — all in parallel
        const results = await Promise.all(toSell.map(w => this.submitSellBundle(w, true)))

        // Retry any misses sequentially (best-effort; ~8% Jito miss rate)
        const failed = toSell.filter((_, i) => !results[i])
        if (failed.length > 0) {
            console.log(`HumanVolumeBot: Retrying ${failed.length} failed shutdown sell(s)`)
            for (const w of failed) {
                await this.submitSellBundle(w, true)
            }
        }

        await Promise.all(this.walletPool.map(w => this.consolidateSOL(w)))

        console.log("HumanVolumeBot: Shutdown complete. All positions closed and SOL consolidated.")
    }
}

