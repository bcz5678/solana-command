import { NextRequest, NextResponse } from 'next/server'
import { requireSuperAdmin } from '@/lib/auth/require-super-admin'
import { PublicKey } from '@solana/web3.js'
import BN from 'bn.js'
import { HumanVolumeBot } from '@/lib/volume/human-volume'
import { QuicknodeJitoExecutor } from '@/lib/jito/clients/quicknode-jito-executor'
import { initializeQuickNodeSolana } from '@/app/api/utils/helpers'

export const dynamic     = 'force-dynamic'
export const maxDuration = 120

// Module-level singleton — persists across requests within the same server process
let bot:           HumanVolumeBot | null = null
let isShuttingDown = false

interface StartBotBody {
    tokenMint:     string
    fundingWallet: { id: string; publicKey: string }
    walletsList:   { id: string; publicKey: string }[]
    buyAmountLamports:      { min: number; max: number }
    sellPercent:            { min: number; max: number }
    jitoTipLamports?:       number
    totalCycles?:           number
    minHoldCycles?:         number
    maxHoldCycles?:         number
    cycleIntervalMs?:       number
    cycleJitterMs?:         number
    minWalletLamports?:     number
    txFeeBufferLamports?:   number
    maxSellTranches?:       number
    buysPerCycleMin?:       number
    buysPerCycleMax?:       number
}

// ── GET: status ───────────────────────────────────────────────────────────────
export async function GET() {
    try { await requireSuperAdmin() } catch (res) { return res as Response }

    if (!bot) {
        return NextResponse.json({ running: false, paused: false, cycleIndex: null, walletPool: null })
    }

    return NextResponse.json({
        running:       bot.volumeLoopRunning,
        paused:        !bot.volumeLoopRunning && !isShuttingDown,
        shuttingDown:  isShuttingDown,
        ...bot.getStatus(),
    })
}

// ── POST: start ───────────────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
    try { await requireSuperAdmin() } catch (res) { return res as Response }

    if (bot?.volumeLoopRunning) {
        return NextResponse.json({ error: 'Bot is already running' }, { status: 409 })
    }
    if (bot && !bot.volumeLoopRunning) {
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
        buyAmountLamports,
        sellPercent,
        jitoTipLamports,
        totalCycles,
        minHoldCycles,
        maxHoldCycles,
        cycleIntervalMs,
        cycleJitterMs,
        minWalletLamports,
        txFeeBufferLamports,
        maxSellTranches,
        buysPerCycleMin,
        buysPerCycleMax,
    } = body

    if (!tokenMint || !fundingWallet?.id || !fundingWallet?.publicKey || !walletsList?.length) {
        return NextResponse.json(
            { error: 'tokenMint, fundingWallet.id, fundingWallet.publicKey, and walletsList are required' },
            { status: 400 },
        )
    }

    if (!buyAmountLamports?.min || !buyAmountLamports?.max || buyAmountLamports.min > buyAmountLamports.max) {
        return NextResponse.json({ error: 'buyAmountLamports.min and .max are required and min must be ≤ max' }, { status: 400 })
    }

    if (!sellPercent?.min || !sellPercent?.max || sellPercent.min > sellPercent.max) {
        return NextResponse.json({ error: 'sellPercent.min and .max are required and min must be ≤ max' }, { status: 400 })
    }

    try {
        const connection = initializeQuickNodeSolana().connection

        const executor = await QuicknodeJitoExecutor.create({
            endpoint:    process.env.SOLANA_RPC_URL!,
            tipLamports: jitoTipLamports ?? 1_000_000,
        })

        bot = new HumanVolumeBot({
            executor,
            connection,
            tokenMint:     new PublicKey(tokenMint),
            fundingWallet: { id: fundingWallet.id, publicKey: new PublicKey(fundingWallet.publicKey) },
            buyAmountLamports: {
                min: new BN(buyAmountLamports.min),
                max: new BN(buyAmountLamports.max),
            },
            sellPercent,
            jitoTipLamports:     jitoTipLamports    != null ? new BN(jitoTipLamports)    : undefined,
            totalCycles,
            minHoldCycles,
            maxHoldCycles,
            cycleIntervalMs,
            cycleJitterMs,
            minWalletLamports:   minWalletLamports   != null ? new BN(minWalletLamports)   : undefined,
            txFeeBufferLamports: txFeeBufferLamports  != null ? new BN(txFeeBufferLamports)  : undefined,
            maxSellTranches,
            buysPerCycleMin,
            buysPerCycleMax,
        })

        bot.initializeWalletPool(walletsList)

        // Fire-and-forget — loop runs on the server, route returns immediately
        void bot.startVolumeLoop()

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

    if (bot.volumeLoopRunning) {
        return NextResponse.json({ error: 'Bot is already running' }, { status: 409 })
    }

    void bot.startVolumeLoop()
    return NextResponse.json({ resumed: true })
}

// ── DELETE: stop or full shutdown ─────────────────────────────────────────────
//
//   ?action=stop     — halts the loop after the current tick; positions stay open
//   ?action=shutdown — (default) stops loop + sells all open positions + consolidates SOL
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
            bot.stopVolumeLoop()
            return NextResponse.json({ stopped: true, note: 'loop halted — positions remain open' })
        }

        // Full graceful shutdown
        isShuttingDown = true
        bot.stopVolumeLoop()
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
