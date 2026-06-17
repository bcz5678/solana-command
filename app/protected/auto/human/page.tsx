'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { TokenMintInput } from '@/components/trade/strategy-trade/TokenMintInput'
import StrategyWalletSelector from '@/components/trade/strategy-trade/strategy-wallet-selector'
import BotConfigPanel, { BotConfigState, DEFAULT_BOT_CONFIG } from '@/components/auto/human/bot-config-panel'
import BotStatusPanel, { BotStatusResponse } from '@/components/auto/human/bot-status-panel'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { lamportsStringToBN } from '@/lib/lamports'
import type { WalletRecord } from '@/lib/types/wallet'

const POLL_INTERVAL_MS = 2_000

function solToLamports(sol: string): number {
    return Math.round(parseFloat(sol) * 1_000_000_000)
}

export default function HumanVolumeBotPage() {
    // ── Token ──────────────────────────────────────────────────────────────────
    const [tokenMint,     setTokenMint]     = useState('')
    const [tokenResolved, setTokenResolved] = useState(false)
    const [tokenName,     setTokenName]     = useState('')
    const [tokenSymbol,   setTokenSymbol]   = useState('')

    // ── Config ─────────────────────────────────────────────────────────────────
    const [config, setConfig] = useState<BotConfigState>(DEFAULT_BOT_CONFIG)

    const handleConfigChange = useCallback((key: keyof BotConfigState, value: string) => {
        setConfig(prev => ({ ...prev, [key]: value }))
    }, [])

    // ── Wallets ────────────────────────────────────────────────────────────────
    const [wallets,         setWallets]         = useState<WalletRecord[]>([])
    const [walletsLoading,  setWalletsLoading]  = useState(false)
    const [fundingWalletId, setFundingWalletId] = useState('')
    const [poolWalletIds,   setPoolWalletIds]   = useState<Set<string>>(new Set())

    // Fetch wallet list for funding wallet dropdown + public key lookup on submit
    useEffect(() => {
        setWalletsLoading(true)
        fetch('/api/wallets/explorer')
            .then(r => r.ok ? r.json() : null)
            .then(data => {
                if (!data) return
                setWallets((data.wallets ?? []).map((w: WalletRecord & { solana_balance_in_lamports?: string }) => ({
                    ...w,
                    solana_balance_in_lamports: w.solana_balance_in_lamports != null
                        ? lamportsStringToBN(String(w.solana_balance_in_lamports))
                        : null,
                })))
            })
            .catch(() => {})
            .finally(() => setWalletsLoading(false))
    }, [])

    // Drop funding wallet from pool selection if user accidentally picks the same one
    useEffect(() => {
        if (fundingWalletId && poolWalletIds.has(fundingWalletId)) {
            setPoolWalletIds(prev => {
                const next = new Set(prev)
                next.delete(fundingWalletId)
                return next
            })
        }
    }, [fundingWalletId, poolWalletIds])

    // ── Bot status + polling ───────────────────────────────────────────────────
    const [botStatus, setBotStatus] = useState<BotStatusResponse | null>(null)
    const [isLoading, setIsLoading] = useState(false)
    const [error,     setError]     = useState('')
    const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

    const fetchStatus = useCallback(() => {
        fetch('/api/auto/human')
            .then(r => r.ok ? r.json() : null)
            .then(data => { if (data) setBotStatus(data) })
            .catch(() => {})
    }, [])

    useEffect(() => { fetchStatus() }, [fetchStatus])

    useEffect(() => {
        if (botStatus?.running) {
            pollRef.current = setInterval(fetchStatus, POLL_INTERVAL_MS)
        } else {
            if (pollRef.current) clearInterval(pollRef.current)
        }
        return () => { if (pollRef.current) clearInterval(pollRef.current) }
    }, [botStatus?.running, fetchStatus])

    // ── Derived ────────────────────────────────────────────────────────────────
    const isRunning     = botStatus?.running ?? false
    const fundingWallet = wallets.find(w => w.id === fundingWalletId)

    const canStart = tokenResolved && !!fundingWalletId && poolWalletIds.size >= 2 && !isRunning

    // ── Handlers ───────────────────────────────────────────────────────────────
    async function handleStart() {
        if (!canStart || !fundingWallet) return
        setError('')
        setIsLoading(true)
        try {
            const walletsList = Array.from(poolWalletIds)
                .filter(id => id !== fundingWalletId)
                .map(id => wallets.find(w => w.id === id))
                .filter((w): w is WalletRecord => !!w)
                .map(w => ({ id: w.id, publicKey: w.public_key }))

            const body = {
                tokenMint,
                fundingWallet: { id: fundingWallet.id, publicKey: fundingWallet.public_key },
                walletsList,
                buyAmountLamports: {
                    min: solToLamports(config.buyAmountMinSol),
                    max: solToLamports(config.buyAmountMaxSol),
                },
                sellPercent: {
                    min: parseInt(config.sellPercentMin),
                    max: parseInt(config.sellPercentMax),
                },
                jitoTipLamports:     solToLamports(config.jitoTipSol),
                totalCycles:         parseInt(config.totalCycles),
                minHoldCycles:       parseInt(config.minHoldCycles),
                maxHoldCycles:       parseInt(config.maxHoldCycles),
                cycleIntervalMs:     parseInt(config.cycleIntervalMs),
                cycleJitterMs:       parseInt(config.cycleJitterMs),
                minWalletLamports:   solToLamports(config.minWalletSol),
                txFeeBufferLamports: solToLamports(config.txFeeBufferSol),
                maxSellTranches:     parseInt(config.maxSellTranches),
                buysPerCycleMin:     parseInt(config.buysPerCycleMin),
                buysPerCycleMax:     parseInt(config.buysPerCycleMax),
            }

            const res  = await fetch('/api/auto/human', {
                method:  'POST',
                headers: { 'Content-Type': 'application/json' },
                body:    JSON.stringify(body),
            })
            const data = await res.json()
            if (!res.ok) throw new Error(data.error ?? 'Failed to start bot')
            fetchStatus()
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Start failed')
        } finally {
            setIsLoading(false)
        }
    }

    async function handleResume() {
        setError('')
        setIsLoading(true)
        try {
            const res  = await fetch('/api/auto/human', { method: 'PATCH' })
            const data = await res.json()
            if (!res.ok) throw new Error(data.error ?? 'Resume failed')
            fetchStatus()
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Resume failed')
        } finally {
            setIsLoading(false)
        }
    }

    async function handleShutdown() {
        setError('')
        setIsLoading(true)
        try {
            const res  = await fetch('/api/auto/human?action=shutdown', { method: 'DELETE' })
            const data = await res.json()
            if (!res.ok) throw new Error(data.error ?? 'Shutdown failed')
            fetchStatus()
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Shutdown failed')
        } finally {
            setIsLoading(false)
        }
    }

    async function handleStop() {
        setError('')
        setIsLoading(true)
        try {
            const res  = await fetch('/api/auto/human?action=stop', { method: 'DELETE' })
            const data = await res.json()
            if (!res.ok) throw new Error(data.error ?? 'Stop failed')
            fetchStatus()
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Stop failed')
        } finally {
            setIsLoading(false)
        }
    }

    // ── Render ─────────────────────────────────────────────────────────────────
    return (
        <div className="flex flex-col gap-6 p-6 w-full min-h-0">

            {/* Header */}
            <div>
                <h1 className="text-lg font-semibold">Human Volume Bot</h1>
                <p className="text-xs text-muted-foreground mt-0.5">
                    Rolling buy/sell cycles on pump.fun bonding curve via Jito bundles
                </p>
            </div>

            {/* Error banner */}
            {error && (
                <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
                    {error}
                </div>
            )}

            {/* Status + Controls */}
            <div className="rounded-lg border border-border p-4">
                <BotStatusPanel
                    status={botStatus}
                    isLoading={isLoading}
                    canStart={canStart}
                    onStart={handleStart}
                    onResume={handleResume}
                    onShutdown={handleShutdown}
                    onStop={handleStop}
                />
            </div>

            {/* Row: Token + Funding Wallet */}
            <div className="rounded-lg border border-border p-4">
                <p className="text-xs font-semibold mb-4">Target</p>
                <div className="flex flex-wrap gap-6">
                    <div className="flex flex-col gap-1.5 flex-1 min-w-52">
                        <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                            Token
                        </label>
                        <TokenMintInput
                            onTokenChange={(mint, resolved, name, symbol) => {
                                setTokenMint(mint)
                                setTokenResolved(resolved)
                                setTokenName(name ?? '')
                                setTokenSymbol(symbol ?? '')
                            }}
                        />
                        {tokenResolved && (
                            <p className="text-xs text-muted-foreground font-mono">
                                {tokenSymbol && <span className="font-semibold text-foreground">{tokenSymbol}</span>}
                                {tokenName  && <span className="ml-1.5">{tokenName}</span>}
                            </p>
                        )}
                    </div>

                    <div className="flex flex-col gap-1.5 flex-1 min-w-52">
                        <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                            Funding Wallet
                        </label>
                        <Select
                            value={fundingWalletId}
                            onValueChange={setFundingWalletId}
                            disabled={isRunning || walletsLoading}
                        >
                            <SelectTrigger className="h-9 text-xs w-full">
                                <SelectValue
                                    placeholder={walletsLoading ? 'Loading wallets…' : 'Select funding wallet'}
                                />
                            </SelectTrigger>
                            <SelectContent>
                                {wallets.map(w => (
                                    <SelectItem key={w.id} value={w.id} className="text-xs">
                                        <span className="font-mono">
                                            {w.public_key.slice(0, 7)}…{w.public_key.slice(-5)}
                                        </span>
                                        {w.label && (
                                            <span className="ml-2 text-muted-foreground">{w.label}</span>
                                        )}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                        {fundingWallet && (
                            <p className="text-xs text-muted-foreground font-mono break-all">
                                {fundingWallet.public_key}
                            </p>
                        )}
                    </div>
                </div>
            </div>

            {/* Row: Bot Configuration (full width, 4 inputs per row) */}
            <div className="rounded-lg border border-border p-4">
                <p className="text-xs font-semibold mb-4">Bot Configuration</p>
                <BotConfigPanel
                    config={config}
                    onChange={handleConfigChange}
                    disabled={isRunning}
                />
            </div>

            {/* Pool Wallet Selector */}
            <div className="flex flex-col gap-2">
                <div className="flex items-center justify-between">
                    <p className="text-xs font-semibold">Pool Wallets</p>
                    <span className="text-xs text-muted-foreground">
                        {poolWalletIds.size >= 2
                            ? `${poolWalletIds.size} selected`
                            : `${poolWalletIds.size} selected — need at least 2`}
                    </span>
                </div>
                <StrategyWalletSelector
                    selectedIds={poolWalletIds}
                    onSelectionChange={setPoolWalletIds}
                    onTradeAmountChange={() => {}}
                    onTradeAmountReset={() => {}}
                    defaultTypeName="Volume"
                    tradeType="buy"
                    hideSupplyColumn={true}
                    hideTradeAmountColumn={true}
                />
            </div>

        </div>
    )
}
