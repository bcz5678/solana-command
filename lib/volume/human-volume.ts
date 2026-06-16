import { Connection, Keypair, PublicKey, SystemProgram, Transaction, TransactionInstruction, TransactionMessage, VersionedTransaction, sendAndConfirmTransaction } from "@solana/web3.js"
import { TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID, getAssociatedTokenAddressSync } from "@solana/spl-token"
import { PUMP_SDK, OnlinePumpSdk, getSellSolAmountFromTokenAmount, getBuyTokenAmountFromSolAmount } from "@nirholas/pump-sdk"
import { getWalletKeypairById } from "@/lib/vault/get-wallet-by-id";
import { QuicknodeJitoExecutor } from "@/lib/jito/clients/quicknode-jito-executor";
import BN from 'bn.js';





export interface HumanVolumeBotConfig {
    executor: QuicknodeJitoExecutor  // pre-built via QuicknodeJitoExecutor.create()
    connection: Connection            // QuickNode RPC connection for balance checks
    buyAmountLamports: BN            // per-wallet buy amount in lamports
    sellPercent: number              // random portion of tokens to sell (looks organic)
    fundingWallet: Keypair           // master keypair with SOL reserve
    tokenMint: Keypair               // target pump.fun token mint
    jitoTipLamports?: BN             // tip per bundle in lamports (default 1_000_000 = 0.001 SOL)
    totalCycles?: number             // defaults to 1_000_000 (runs until stopped)
    minHoldCycles?: number           // wallet must survive at least N cycles before eligible to sell
    maxHoldCycles?: number           // force sell if wallet has held this many cycles
    cycleIntervalMs?: number         // base delay between bundles
    cycleJitterMs?: number           // ± random jitter added to each interval
    minWalletLamports?: BN           // top-up threshold in lamports (default 20_000_000 = 0.02 SOL)
}

export interface WalletRecord {
      id:            string             // wallet UUID identifier
      publicKey:     PublicKey
      state:         'IDLE' | 'BUYING' | 'HOLDING' | 'SELLING'
      tokenBalanceRaw: BN               // raw token units (pump.fun base units, 6 decimals)
      lamportsSpent:   BN               // lamports spent on the buy
      boughtAtCycle: number | null      // cycle index when position was opened
      holdCycles:    number | null      // how many cycles this wallet has held
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
    private buyAmountLamports: BN
    private sellPercent: number
    private fundingWallet: Keypair
    private tokenMint: Keypair
    private jitoTipLamports: BN
    private minHoldCycles: number
    private maxHoldCycles: number
    private totalCycles: number
    private cycleIntervalMs: number
    private cycleJitterMs: number
    private minWalletLamports: BN

    private walletPool: WalletRecord[]

    private isVolumeLoopRunning: boolean
    private volumeLoopOptions: Required<VolumeLoopOptions<T>>;
    private cycleIndex: number

    private executor: QuicknodeJitoExecutor


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

        this.executor = executor;
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
            :setTimeout(resolve, 0) 
    }


    // ─── Public API ────────────────────────────────────────────

    /**
     * Starts the run loop asynchronously.
     * Returns a Promise that resolves when the loop exits.
     * Safe to call with `void` if you don't need to await it.
     * 
     */


    /// Initializes the  pool of Wallets 
    initializeWalletPool(walletsList: {id: string, publicKey: string}[] ) {

        walletsList.forEach((wallet) => {
            this.walletPool.push({
                id:            wallet.id,
                publicKey:     new PublicKey(wallet.publicKey),
                state:         'IDLE',
                tokenBalanceRaw: new BN(0),
                lamportsSpent:   new BN(0),
                boughtAtCycle: null,
                holdCycles:    null,
            });
        });
    }


    async volumeLoopPass(): Promise<void> {
        // ── STEP 1: Check if any HOLDING wallet should exit ──────────────────

        let holdingWallets: WalletRecord[] = this.walletPool.filter(w => w.state == 'HOLDING');
        let sellCandidate: WalletRecord | null = this.selectSellCandidate(holdingWallets);

        if (sellCandidate != null) {
            await this.submitSellBundle(sellCandidate);
            // marks wallet state = SELLING during confirmation wait
        }

        // ── STEP 2: Select next IDLE wallet to buy ───────────────────────────

        let idleWallets: WalletRecord[]  = this.walletPool.filter(w => w.state == 'IDLE');
        let buyCandidate: WalletRecord | null = this.selectBuyCandidate(idleWallets);

        if(buyCandidate != null) {
            await this.checkAndTopUp(buyCandidate)
            await this.submitBuyBundle(buyCandidate)
            // marks wallet state = HOLDING
        }
            
        // ── STEP 3: Increment hold counters on all HOLDING wallets ───────────

        this.walletPool
            .filter(wallet => wallet.state == 'HOLDING')
            .forEach((wallet) => {
                wallet.holdCycles = (wallet.holdCycles ?? 0) + 1
        });

        // ── STEP 4: Wait before next cycle (with jitter) ─────────────────────

        let delay: number = Math.floor(Math.random() * (this.cycleIntervalMs - this.cycleJitterMs)) + this.cycleJitterMs;
        new Promise((resolve) => setTimeout(resolve, delay));

        this.cycleIndex += 1      
    }

    /**
     * Starts the runVolumeLoop asynchronously.
     * Returns a Promise that resolves when the loop exits.
     * Safe to call with `void` if you don't need to await it.
     */
    async startVolumeLoop(): Promise<void> {
        if (this.isVolumeLoopRunning) {
            console.warn("HUmanVolumeExecutor: already running, ignoring startVolumeLoop()");
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
            console.warn("HumanVolumeExecutor: not running, ignoring stopVolumeLoop()");
            return;
        }
        this.isVolumeLoopRunning = false; // checked at top of while loop → exits next cycle
    }

    /** Returns whether the loop is currently active. */
    get volumeLoopRunning(): boolean {
        return this.isVolumeLoopRunning;
    }



    selectSellCandidate(holdingWallets: WalletRecord[]): WalletRecord | null {
        // Force-exit any wallet that has held too long
        // Filter by the longest held wallet
        let overdue: WalletRecord[] = holdingWallets.filter(w => (w.holdCycles ?? 0) >= this.maxHoldCycles);
    
        if(overdue.length > 0){
            return overdue[0]; //return the longest-held wallet
        }

        // Otherwise only sell if at least MIN_HOLD_CYCLES have passed
        // Filter by wallets that are past past minimum hold time and eligible to sell
        let eligibleWallets: WalletRecord[] = holdingWallets.filter(w => (w.holdCycles ?? 0) >= this.minHoldCycles)
    
        if (eligibleWallets.length == 0) {
            return null; // no wallet ready to sell
        }
        
        // Pick randomly from eligible wallets to avoid predictable ordering
        return this.randomPick(eligibleWallets);
    }

    selectBuyCandidate(idleWallets: WalletRecord[]): WalletRecord | null {   
        if (idleWallets.length == 0) {
            // ALl wallets are holding - skip this buy cycle
            return null;
        }
        // Pick randomly (not FIFO) so wallet sequence is unpredictable on-chain
        return this.randomPick(idleWallets); 
    }

    async submitSellBundle(wallet: WalletRecord): Promise<boolean> {
        wallet.state = 'SELLING'
        let walletKeypair: Keypair | null = null

        try {
            // ── Step 1: Read actual on-chain token balance ────────────────────
            const mint = this.tokenMint.publicKey
            const ata  = getAssociatedTokenAddressSync(mint, wallet.publicKey)

            let actualBalanceRaw: BN
            try {
                const resp = await this.connection.getTokenAccountBalance(ata, 'confirmed')
                actualBalanceRaw = new BN(resp.value.amount)
            } catch {
                actualBalanceRaw = new BN(0)
            }

            if (actualBalanceRaw.isZero()) {
                wallet.state         = 'IDLE'
                wallet.tokenBalanceRaw = new BN(0)
                return true
            }

            // ── Step 2: Fetch keypair from vault (wiped in finally) ───────────
            walletKeypair = await getWalletKeypairById(wallet.id)

            // ── Step 3: Randomise sell portion (looks organic) ────────────────
            const sellPercent  = this.randomPercentInRangeInclusive(60, this.sellPercent)
            const sellAmount   = actualBalanceRaw.muln(sellPercent).divn(100)
            const slippage     = this.randomPercentInRangeInclusive(5, 15)

            // ── Step 4: Fetch on-chain state and tip account in parallel ──────
            const onlineSdk = new OnlinePumpSdk(this.connection)
            const [global, feeConfig, mintInfo, sellState, tipAccount, { blockhash }] = await Promise.all([
                onlineSdk.fetchGlobal(),
                onlineSdk.fetchFeeConfig(),
                this.connection.getAccountInfo(mint),
                onlineSdk.fetchSellState(mint, wallet.publicKey),
                this.executor.getTipAccount(),
                this.connection.getLatestBlockhash('confirmed'),
            ])

            // ── Step 5: Build trade instructions (bonding curve or AMM) ─────
            let tradeIxs: TransactionInstruction[]

            if (sellState.bondingCurve.complete) {
                // Token graduated — route through AMM (slippage as decimal)
                tradeIxs = await onlineSdk.ammSellInstructions({
                    mint,
                    user:        walletKeypair.publicKey,
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
                    user:        walletKeypair.publicKey,
                    amount:      sellAmount,
                    solAmount:   solExpected,
                    slippage,
                    tokenProgram,
                })
            }

            const tipIx = SystemProgram.transfer({
                fromPubkey: walletKeypair.publicKey,
                toPubkey:   new PublicKey(tipAccount as string),
                lamports:   this.jitoTipLamports.toNumber(),
            })

            // ── Step 6: Build and sign versioned transaction ──────────────────
            const message = new TransactionMessage({
                payerKey:        walletKeypair.publicKey,
                recentBlockhash: blockhash,
                instructions:    [...tradeIxs, tipIx],
            }).compileToV0Message()

            const tx = new VersionedTransaction(message)
            tx.sign([walletKeypair])

            const encoded = Buffer.from(tx.serialize()).toString('base64') as import('@solana/kit').Base64EncodedWireTransaction

            // ── Step 7: Submit as single-tx Jito bundle ───────────────────────
            await this.executor.sendPrebuiltBundle([encoded], [wallet.publicKey.toBase58()])

            // ── Step 8: Update wallet state ───────────────────────────────────
            const remaining        = actualBalanceRaw.sub(sellAmount)
            wallet.tokenBalanceRaw = remaining
            wallet.state           = remaining.isZero() ? 'IDLE' : 'HOLDING'

            console.log(`[submitSellBundle] LANDED: wallet=${wallet.id} sold=${sellAmount} remaining=${remaining}`)
            return true

        } catch (err) {
            wallet.state = 'HOLDING'
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
            const mint      = this.tokenMint.publicKey
            const solAmount = this.buyAmountLamports
            const slippage  = this.randomPercentInRangeInclusive(5, 15)

            // ── Step 1: Fetch keypair from vault (wiped in finally) ───────────
            walletKeypair = await getWalletKeypairById(wallet.id)

            // ── Step 2: Fetch on-chain state and tip account in parallel ──────
            const onlineSdk = new OnlinePumpSdk(this.connection)
            const [global, feeConfig, mintInfo, buyState, tipAccount, { blockhash }] = await Promise.all([
                onlineSdk.fetchGlobal(),
                onlineSdk.fetchFeeConfig(),
                this.connection.getAccountInfo(mint),
                onlineSdk.fetchBuyState(mint, walletKeypair.publicKey),
                this.executor.getTipAccount(),
                this.connection.getLatestBlockhash('confirmed'),
            ])

            // ── Step 3: Build trade instructions (bonding curve or AMM) ─────
            let tokenAmount = new BN(0)
            let tradeIxs: TransactionInstruction[]

            if (buyState.bondingCurve.complete) {
                // Token graduated — route through AMM (slippage as decimal)
                tradeIxs = await onlineSdk.ammBuyInstructions({
                    mint,
                    user:      walletKeypair.publicKey,
                    solAmount,
                    slippage:  slippage / 100,
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
                    user:        walletKeypair.publicKey,
                    amount:      tokenAmount,
                    solAmount,
                    slippage,
                    tokenProgram,
                })
            }

            const tipIx = SystemProgram.transfer({
                fromPubkey: walletKeypair.publicKey,
                toPubkey:   new PublicKey(tipAccount as string),
                lamports:   this.jitoTipLamports.toNumber(),
            })

            // ── Step 4: Build and sign versioned transaction ──────────────────
            const message = new TransactionMessage({
                payerKey:        walletKeypair.publicKey,
                recentBlockhash: blockhash,
                instructions:    [...tradeIxs, tipIx],
            }).compileToV0Message()

            const tx = new VersionedTransaction(message)
            tx.sign([walletKeypair])

            const encoded = Buffer.from(tx.serialize()).toString('base64') as import('@solana/kit').Base64EncodedWireTransaction

            // ── Step 6: Submit as single-tx Jito bundle ───────────────────────
            await this.executor.sendPrebuiltBundle([encoded], [wallet.publicKey.toBase58()])

            // ── Step 7: Update wallet state ───────────────────────────────────
            wallet.state           = 'HOLDING'
            wallet.tokenBalanceRaw = tokenAmount
            wallet.lamportsSpent   = solAmount
            wallet.boughtAtCycle   = this.cycleIndex
            wallet.holdCycles      = 0

            console.log(`[submitBuyBundle] LANDED: wallet=${wallet.id} tokens=${tokenAmount} lamports=${solAmount}`)
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

    async checkAndTopUp(wallet: WalletRecord): Promise<void> {
        let balance: BN = await this.getSOLBalanceLamports(wallet)
        if (balance < this.minWalletLamports) {
            let needed: BN =  this.jitoTipLamports + 
        }

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

    async getWalletAccountInfo(publicKey: PublicKey) {


    }

    async consolidateSOL(wallet: WalletRecord): Promise<void> {
        
    }

    gracefulShutdowm() {
        console.log("HumanVolumeBot: Shutdown initiated — draining all positions")


        this.walletPool.forEach((wallet) => {
            let isSold: boolean = false
            
            isSold = await this.submitSellBundle(wallet);
            
            if(isSold) {
                this.consolidateSOL(wallet)
            }
            // sell 100% on shutdown
        });

          log("All positions closed. SOL consolidated.")
    }
}

