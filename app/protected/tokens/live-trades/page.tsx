'use client'

import { useState, useEffect, useMemo, useCallback } from 'react'
import { PublicKey } from '@solana/web3.js'
import BN from 'bn.js'
import { TokenMint } from '@/lib/types/token-mint'
import { WalletRecord } from '@/lib/types/wallet'
import { TokenPreview } from '@/lib/types/token-pumpfun'
import { lamportsBNToSolDisplay, lamportsStringToBN } from '@/lib/lamports'
import { Button } from '@/components/ui/button'
import LaunchTradeFeedPanel from '@/components/tokens/launch/launch-trade-feed-panel'

function maskPubKey(key: string) {
    return `${key.slice(0, 7)}....${key.slice(-7)}`
}

// Route returns BN/PublicKey fields JSON-serialized (BN -> hex string, PublicKey -> base58) — same
// parsing used by components/trade/trade/TokenTradePanel.tsx's fetchToken.
function parsePreview(raw: any): TokenPreview {
    return {
        ...raw,
        mint: new PublicKey(raw.mint),
        marketCapSol: raw.marketCapSol != null ? new BN(raw.marketCapSol, 16) : null,
        curve: raw.curve ? {
            bondingCurve:           new PublicKey(raw.curve.bondingCurve),
            associatedBondingCurve: new PublicKey(raw.curve.associatedBondingCurve),
            virtualSolReserves:     new BN(raw.curve.virtualSolReserves,   16),
            virtualTokenReserves:   new BN(raw.curve.virtualTokenReserves, 16),
            realSolReserves:        new BN(raw.curve.realSolReserves,      16),
            realTokenReserves:      new BN(raw.curve.realTokenReserves,    16),
            totalSupply:            new BN(raw.curve.totalSupply,          16),
        } : null,
    }
}

export default function LiveTradesPage() {
    const [tokens, setTokens]               = useState<TokenMint[]>([])
    const [tokensLoading, setTokensLoading]  = useState(true)
    const [wallets, setWallets]              = useState<WalletRecord[]>([])

    const [mode, setMode]                 = useState<'select' | 'paste'>('select')
    const [selectedMint, setSelectedMint] = useState('')
    const [caInput, setCaInput]           = useState('')
    const [activeMint, setActiveMint]     = useState('')

    const [preview, setPreview]             = useState<TokenPreview | null>(null)
    const [previewLoading, setPreviewLoading] = useState(false)
    const [previewError, setPreviewError]     = useState('')

    const [showFeed, setShowFeed] = useState(false)

    useEffect(() => {
        fetch('/api/token-mint/explorer?status=launched&limit=1000')
            .then((r) => r.json())
            .then((data) => setTokens(data.tokens ?? []))
            .catch(() => {})
            .finally(() => setTokensLoading(false))

        fetch('/api/wallets/explorer')
            .then((r) => r.json())
            .then((data) => {
                const parsed: WalletRecord[] = (data.wallets ?? []).map((w: any) => ({
                    ...w,
                    solana_balance_in_lamports: w.solana_balance_in_lamports != null
                        ? lamportsStringToBN(String(w.solana_balance_in_lamports))
                        : null,
                }))
                setWallets(parsed)
            })
            .catch(() => {})
    }, [])

    const ourWallets = useMemo(() => new Set(wallets.map((w) => w.public_key)), [wallets])
    const ourWalletLabels = useMemo(() => {
        const map: Record<string, string> = {}
        for (const w of wallets) if (w.label) map[w.public_key] = w.label
        return map
    }, [wallets])

    const dbToken = useMemo(
        () => tokens.find((t) => t.mint_public_key === activeMint) ?? null,
        [tokens, activeMint],
    )
    const devWallet = useMemo(
        () => (dbToken?.dev_wallet_id ? wallets.find((w) => w.id === dbToken.dev_wallet_id) ?? null : null),
        [dbToken, wallets],
    )

    const fetchPreview = useCallback(async (mint: string) => {
        setPreviewLoading(true)
        setPreviewError('')
        setPreview(null)
        setShowFeed(false)
        try {
            const res = await fetch(`/api/pumpfun/token-info?mintAddress=${encodeURIComponent(mint)}`)
            if (!res.ok) {
                const body = await res.json().catch(() => null)
                throw new Error(body?.error ?? 'Token not found')
            }
            const { body: { preview: raw } } = await res.json()
            setPreview(parsePreview(raw))
            setActiveMint(mint)
        } catch (err) {
            setPreviewError(err instanceof Error ? err.message : 'Failed to load token')
            setActiveMint('')
        } finally {
            setPreviewLoading(false)
        }
    }, [])

    function onSelectToken(mint: string) {
        setSelectedMint(mint)
        setCaInput('')
        if (mint) fetchPreview(mint)
    }

    function onLookupCA() {
        const trimmed = caInput.trim()
        if (!trimmed) return
        try {
            new PublicKey(trimmed)
        } catch {
            setPreviewError('Not a valid Solana address')
            return
        }
        setSelectedMint('')
        fetchPreview(trimmed)
    }

    const mintStr = preview?.mint.toBase58() ?? ''

    return (
        <div className="flex-1 w-full flex flex-col gap-6 p-4 max-w-3xl">
            <h1 className="text-2xl font-bold">Live Token Trades</h1>

            {/* Mode toggle */}
            <div className="flex gap-2">
                <button
                    onClick={() => setMode('select')}
                    className={[
                        'px-3 py-1.5 rounded-full text-xs font-medium border transition-colors',
                        mode === 'select'
                            ? 'bg-blue-500 border-blue-500 text-white'
                            : 'border-border text-muted-foreground hover:border-blue-400 hover:text-foreground',
                    ].join(' ')}
                >
                    Select launched token
                </button>
                <button
                    onClick={() => setMode('paste')}
                    className={[
                        'px-3 py-1.5 rounded-full text-xs font-medium border transition-colors',
                        mode === 'paste'
                            ? 'bg-blue-500 border-blue-500 text-white'
                            : 'border-border text-muted-foreground hover:border-blue-400 hover:text-foreground',
                    ].join(' ')}
                >
                    Paste contract address
                </button>
            </div>

            {mode === 'select' ? (
                <select
                    value={selectedMint}
                    onChange={(e) => onSelectToken(e.target.value)}
                    disabled={tokensLoading}
                    className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                >
                    <option value="">
                        {tokensLoading ? 'Loading tokens…' : `Select a launched token (${tokens.length})`}
                    </option>
                    {tokens.map((t) => (
                        <option key={t.id} value={t.mint_public_key}>
                            {t.token_symbol} — {t.token_name} ({maskPubKey(t.mint_public_key)})
                        </option>
                    ))}
                </select>
            ) : (
                <div className="flex gap-2">
                    <input
                        type="text"
                        value={caInput}
                        onChange={(e) => setCaInput(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && onLookupCA()}
                        placeholder="Paste a mint / contract address…"
                        className="h-9 flex-1 rounded-md border border-input bg-transparent px-3 text-sm font-mono shadow-sm placeholder:font-sans placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                    />
                    <Button onClick={onLookupCA} disabled={!caInput.trim() || previewLoading}>
                        Look Up
                    </Button>
                </div>
            )}

            {previewLoading && (
                <p className="text-sm text-muted-foreground">Loading token info…</p>
            )}

            {previewError && (
                <p className="text-sm text-destructive">{previewError}</p>
            )}

            {preview && !previewLoading && (
                <div className="rounded-xl border border-border bg-card p-4 flex flex-col gap-4">
                    <div className="flex items-center gap-3.5">
                        {preview.imageUri ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                                src={preview.imageUri}
                                alt={preview.name}
                                onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }}
                                className="size-12 shrink-0 rounded-lg object-cover"
                            />
                        ) : (
                            <div className="size-12 shrink-0 rounded-lg bg-muted flex items-center justify-center font-mono text-xs font-bold text-muted-foreground">
                                {preview.symbol?.slice(0, 2).toUpperCase()}
                            </div>
                        )}

                        <div className="flex-1 min-w-0">
                            <div className="flex flex-wrap items-center gap-2">
                                <span className="text-sm font-semibold text-foreground truncate">{preview.name}</span>
                                <span className="font-mono text-xs text-muted-foreground">${preview.symbol}</span>
                                {preview.complete && (
                                    <span className="rounded px-1.5 py-0.5 text-[10px] font-semibold bg-amber-500/15 text-amber-600">
                                        GRADUATED
                                    </span>
                                )}
                                {dbToken && (
                                    <span className="rounded px-1.5 py-0.5 text-[10px] font-semibold bg-green-500/15 text-green-600">
                                        IN OUR SYSTEM
                                    </span>
                                )}
                            </div>
                            <p className="font-mono text-xs text-muted-foreground truncate">{mintStr}</p>
                        </div>

                        <Button onClick={() => setShowFeed((v) => !v)}>
                            {showFeed ? 'Hide' : 'Watch'} Live Trades
                        </Button>
                    </div>

                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                        {[
                            { label: 'Price', value: preview.pricePerTokenSol != null ? preview.pricePerTokenSol.toExponential(4) : '—', unit: 'SOL' },
                            { label: 'Market Cap', value: preview.marketCapSol ? lamportsBNToSolDisplay(preview.marketCapSol) : '—', unit: 'SOL' },
                            { label: 'Status', value: preview.complete ? 'Graduated' : 'Bonding Curve', unit: '' },
                        ].map(({ label, value, unit }) => (
                            <div key={label} className="rounded-lg bg-muted/50 px-3 py-2.5 flex flex-col gap-1">
                                <span className="text-[0.65rem] font-medium uppercase tracking-wider text-muted-foreground">
                                    {label}
                                </span>
                                <span className="font-mono text-sm font-semibold text-foreground">
                                    {value}
                                    {unit && <span className="text-xs font-normal text-muted-foreground"> {unit}</span>}
                                </span>
                            </div>
                        ))}
                    </div>

                    {devWallet && (
                        <div className="rounded-lg border border-blue-500/30 bg-blue-500/5 px-3 py-2 flex items-center justify-between gap-2">
                            <div className="min-w-0">
                                <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Dev Wallet</p>
                                <p className="font-mono text-xs truncate">{devWallet.label ?? maskPubKey(devWallet.public_key)}</p>
                            </div>
                            <span className="shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold bg-blue-500/20 text-blue-500">
                                OURS
                            </span>
                        </div>
                    )}

                    <div className="flex gap-3">
                        <a
                            href={`https://solscan.io/token/${mintStr}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex-1 text-center px-4 py-2.5 text-sm font-semibold rounded-xl border border-border hover:bg-muted transition-colors"
                        >
                            View on Solscan
                        </a>
                        <a
                            href={`https://pump.fun/${mintStr}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex-1 text-center px-4 py-2.5 text-sm font-semibold rounded-xl bg-blue-500 text-white hover:bg-blue-600 transition-colors"
                        >
                            View on Pump.fun
                        </a>
                    </div>
                </div>
            )}

            {showFeed && preview && (
                <LaunchTradeFeedPanel
                    mintAddress={mintStr}
                    tokenSymbol={preview.symbol}
                    ourWallets={ourWallets}
                    ourWalletLabels={ourWalletLabels}
                />
            )}
        </div>
    )
}
