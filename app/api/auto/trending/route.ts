import { NextRequest, NextResponse } from 'next/server'
import { requireSuperAdmin } from '@/lib/auth/require-super-admin'
import { PublicKey } from '@solana/web3.js'
import BN from 'bn.js'
import { TrendingVolumeBot } from '@/lib/trade/trending-volume-bot'
import { QuicknodeJitoExecutor } from '@/lib/jito/clients/quicknode-jito-executor'
import { initializeQuickNodeSolana } from '@/app/api/utils/helpers'

export const dynamic     = 'force-dynamic'
export const maxDuration = 120

// Module-level singleton — persists across requests within the same server
// process, same pattern as lib/pumpfun/comment-scheduler.ts and the `bot`
// singleton in app/api/auto/human/route.ts.
let bot:           TrendingVolumeBot | null = null
let isShuttingDown = false

interface StartBotBody {
    tokenMint:     string
    fundingWallet: { id: string; publicKey: string }
    walletsList:   { id: string; publicKey: string }[]
    solAmountLamports:    { min: number; max: number }
    jitoTipLamports?:     number
    slippage?:            number
    /** Slippage for round-trips on graduated (PumpAMM) tokens — wider than `slippage` by default since that leg is priced against pre-buy reserves. */
    ammSlippage?:         number
    totalRounds?:         number
    roundIntervalMs?:     number
    roundJitterMs?:       number
    walletsPerRoundMin?:  number
    walletsPerRoundMax?:  number
    minWalletLamports?:   number
    txFeeBufferLamports?: number
    /** Simulate trade bundles and skip real top-up/consolidation transfers. */
    dryRun?: boolean
}

// ── GET: status ───────────────────────────────────────────────────────────────
export async function GET() {
    try { await requireSuperAdmin() } catch (res) { return res as Response }

    if (!bot) {
        return NextResponse.json({ running: false, paused: false, roundIndex: null, walletPool: null })
    }

    return NextResponse.json({
        running:       bot.trendingLoopRunning,
        paused:        !bot.trendingLoopRunning && !isShuttingDown,
        shuttingDown:  isShuttingDown,
        ...bot.getStatus(),
    })
}

// ── POST: start ───────────────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
    try { await requireSuperAdmin() } catch (res) { return res as Response }

    if (bot?.trendingLoopRunning) {
        return NextResponse.json({ error: 'Bot is already running' }, { status: 409 })
    }
    if (bot && !bot.trendingLoopRunning) {
        return NextResponse.json({ error: 'Bot is paused — resume or shutdown before starting fresh' }, { status: 409 })
    }

    let body: StartBotBody
    try {
        body = await req.json()
    } catch {
        return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
    }

    const {
        tokenMint,
        fundingWallet,
        walletsList,
        solAmountLamports,
        jitoTipLamports,
        slippage,
        ammSlippage,
        totalRounds,
        roundIntervalMs,
        roundJitterMs,
        walletsPerRoundMin,
        walletsPerRoundMax,
        minWalletLamports,
        txFeeBufferLamports,
        dryRun,
    } = body

    if (!tokenMint || !fundingWallet?.id || !fundingWallet?.publicKey || !walletsList?.length) {
        return NextResponse.json(
            { error: 'tokenMint, fundingWallet.id, fundingWallet.publicKey, and walletsList are required' },
            { status: 400 },
        )
    }

    if (!solAmountLamports?.min || !solAmountLamports?.max || solAmountLamports.min > solAmountLamports.max) {
        return NextResponse.json({ error: 'solAmountLamports.min and .max are required and min must be ≤ max' }, { status: 400 })
    }

    try {
        const connection = initializeQuickNodeSolana().connection

        const executor = await QuicknodeJitoExecutor.create({
            endpoint:     process.env.SOLANA_RPC_URL!,
            tipLamports:  jitoTipLamports ?? 500_000,
            simulateOnly: dryRun,
        })

        bot = new TrendingVolumeBot({
            executor,
            connection,
            tokenMint:     new PublicKey(tokenMint),
            fundingWallet: { id: fundingWallet.id, publicKey: new PublicKey(fundingWallet.publicKey) },
            solAmountLamports: {
                min: new BN(solAmountLamports.min),
                max: new BN(solAmountLamports.max),
            },
            jitoTipLamports:      jitoTipLamports      != null ? new BN(jitoTipLamports)      : undefined,
            slippage,
            ammSlippage,
            totalRounds,
            roundIntervalMs,
            roundJitterMs,
            walletsPerRoundMin,
            walletsPerRoundMax,
            minWalletLamports:    minWalletLamports    != null ? new BN(minWalletLamports)    : undefined,
            txFeeBufferLamports:  txFeeBufferLamports  != null ? new BN(txFeeBufferLamports)  : undefined,
            dryRun,
        })

        bot.initializeWalletPool(walletsList)

        // Fire-and-forget — loop runs on the server, route returns immediately
        void bot.startTrendingLoop()

        return NextResponse.json({ started: true, walletCount: walletsList.length })

    } catch (err) {
        bot = null
        const message = err instanceof Error ? err.message : 'Failed to start bot'
        return NextResponse.json({ error: message }, { status: 500 })
    }
}

// ── PATCH: resume a paused bot ────────────────────────────────────────────────
export async function PATCH() {
    try { await requireSuperAdmin() } catch (res) { return res as Response }

    if (!bot) {
        return NextResponse.json({ error: 'No paused bot to resume' }, { status: 404 })
    }

    if (bot.trendingLoopRunning) {
        return NextResponse.json({ error: 'Bot is already running' }, { status: 409 })
    }

    void bot.startTrendingLoop()
    return NextResponse.json({ resumed: true })
}

// ── DELETE: stop or full shutdown ─────────────────────────────────────────────
//
//   ?action=stop     — halts the loop after the current round; no positions to close
//   ?action=shutdown — (default) stops loop + consolidates leftover SOL back to funding wallet
export async function DELETE(req: NextRequest) {
    try { await requireSuperAdmin() } catch (res) { return res as Response }

    if (!bot) {
        return NextResponse.json({ error: 'No bot is running' }, { status: 404 })
    }

    if (isShuttingDown) {
        return NextResponse.json({ error: 'Shutdown already in progress' }, { status: 409 })
    }

    const { searchParams } = new URL(req.url)
    const action = searchParams.get('action') ?? 'shutdown'

    try {
        if (action === 'stop') {
            bot.stopTrendingLoop()
            return NextResponse.json({ stopped: true, note: 'loop halted' })
        }

        isShuttingDown = true
        bot.stopTrendingLoop()
        await bot.shutdown()
        bot = null
        return NextResponse.json({ shutdown: true })

    } catch (err) {
        const message = err instanceof Error ? err.message : 'Shutdown failed'
        return NextResponse.json({ error: message }, { status: 500 })
    } finally {
        isShuttingDown = false
    }
}
