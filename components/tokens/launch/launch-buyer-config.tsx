'use client'

import { useState, useEffect, useMemo, Fragment } from 'react'
import { LaunchType } from '@/components/tokens/launch/types'
import { LaunchConfig } from '@/components/tokens/launch/launch-config-class';
import { lamportsBNToSolDisplay, lamportsStringToBN } from '@/lib/lamports';
import { WalletRecord } from '@/lib/types/wallet';
import BN from 'bn.js';

type WalletTypeRow = { id: string; name: string }

type Props = {
    launchConfig: LaunchConfig
    onBuyInputChange: (walletId: string, newAmount: string) => void
    onBuyInputReset: () => void
}

function maskPubKey(key: string) {
    return `${key.slice(0, 7)}....${key.slice(-7)}`
}

export default function LaunchBuyerConfig({ launchConfig, onBuyInputChange, onBuyInputReset }: Props) {
    const [wallets, setWallets]         = useState<WalletRecord[]>([])
    const [walletTypes, setWalletTypes] = useState<WalletTypeRow[]>([])
    const [loading, setLoading]         = useState(true)
    const [activeFilters, setActiveFilters] = useState<string[]>([])
    const [buyAmounts, setBuyAmounts]   = useState<Record<string, string>>({})

    useEffect(() => {
        fetch('/api/wallets/explorer')
            .then((r) => {
                if (!r.ok) {
                    r.json().then(body => console.error('[wallets] API error', r.status, body))
                    return
                }
                return r.json()
            })
            .then((data) => {
                if (!data) return
                const parsed: WalletRecord[] = (data.wallets ?? []).map((w: any) => ({
                    ...w,
                    solana_balance_in_lamports: w.solana_balance_in_lamports != null
                        ? lamportsStringToBN(String(w.solana_balance_in_lamports))
                        : null,
                }))
                setWallets(parsed)
                setWalletTypes(data.walletTypes ?? [])
                setLoading(false)
            })
            .catch(err => {
                console.error('[wallets] fetch failed', err)
                setLoading(false)
            })
    }, [])

    const devWalletId = launchConfig.token?.dev_wallet_id != null
        ? String(launchConfig.token.dev_wallet_id)
        : null

    const devWallet = useMemo(
        () => (devWalletId ? wallets.find((w) => w.id === devWalletId) : null) ?? null,
        [wallets, devWalletId],
    )

    const otherWallets = useMemo(
        () => wallets.filter((w) => w.id !== devWalletId),
        [wallets, devWalletId],
    )

    const groups = useMemo(() => {
        const filtered =
            activeFilters.length > 0
                ? otherWallets.filter((w) => w.wallet_type_id != null && activeFilters.includes(w.wallet_type_id))
                : otherWallets

        return walletTypes
            .map((type) => ({
                type,
                wallets: filtered.filter((w) => w.wallet_type_id === type.id),
            }))
            .filter((g) => g.wallets.length > 0)
    }, [otherWallets, walletTypes, activeFilters])

    function toggleFilter(typeId: string) {
        setActiveFilters((prev) =>
            prev.includes(typeId) ? prev.filter((id) => id !== typeId) : [...prev, typeId],
        )
    }

    function setBuyAmount(walletId: string, newAmount: string) {
        onBuyInputChange(walletId, newAmount)
        setBuyAmounts((prev) => ({ ...prev, [walletId]: newAmount }))
    }

    function clearAll() {
        setBuyAmounts({})
        onBuyInputReset()
    }

    if (loading) return <p className="text-sm text-muted-foreground py-4">Loading wallets…</p>

    let rowIndex = 0

    return (
        <div className="flex flex-col gap-4">
            {/* Type filter chips */}
            <div className="flex flex-wrap gap-2">
                <button
                    onClick={() => setActiveFilters([])}
                    className={[
                        'px-3 py-1 rounded-full text-xs font-medium border transition-colors',
                        activeFilters.length === 0
                            ? 'bg-blue-500 border-blue-500 text-white'
                            : 'border-border text-muted-foreground hover:border-blue-400 hover:text-foreground',
                    ].join(' ')}
                >
                    All
                </button>
                {walletTypes.map((type) => (
                    <button
                        key={type.id}
                        onClick={() => toggleFilter(type.id)}
                        className={[
                            'px-3 py-1 rounded-full text-xs font-medium border transition-colors',
                            activeFilters.includes(type.id)
                                ? 'bg-blue-500 border-blue-500 text-white'
                                : 'border-border text-muted-foreground hover:border-blue-400 hover:text-foreground',
                        ].join(' ')}
                    >
                        {type.name}
                    </button>
                ))}
            </div>

            {/* Table */}
            <div className="w-full overflow-x-auto overflow-y-auto max-h-[600px] rounded-md border">
                <table className="w-full text-sm border-collapse">
                    <thead className="sticky top-0 z-10 bg-muted">
                        <tr className="border-b text-xs font-medium uppercase tracking-wider text-muted-foreground">
                            <th className="px-3 py-2.5 text-left w-10">#</th>
                            <th className="px-3 py-2.5 text-left">Public Key</th>
                            <th className="px-3 py-2.5 text-right">SOL Balance</th>
                            <th className="px-3 py-2.5 text-right">Token Amount</th>
                            <th className="px-3 py-2.5 text-right">% Supply</th>
                            <th className="px-3 py-2.5 text-right">
                                <div className="flex items-center justify-end gap-2">
                                    Buy (SOL)
                                    <button
                                        onClick={clearAll}
                                        className="normal-case tracking-normal font-normal text-[10px] border border-border rounded px-1.5 py-0.5 text-muted-foreground hover:text-destructive hover:border-destructive transition-colors"
                                    >
                                        Clear all
                                    </button>
                                </div>
                            </th>
                        </tr>
                    </thead>
                    <tbody>
                        {/* Dev wallet — stickied below header */}
                        {devWallet && (
                            <tr className="sticky top-[41px] z-10 border-b bg-red-500/5">
                                <td className="px-3 py-2.5">
                                    <span className="flex size-6 items-center justify-center rounded-full border-2 border-red-500 text-[10px] font-bold text-red-500">
                                        D
                                    </span>
                                </td>
                                <td className="px-3 py-2.5 font-mono text-xs">
                                    {maskPubKey(devWallet.public_key)}
                                </td>
                                <td className="px-3 py-2.5 text-right text-muted-foreground tabular-nums">
                                    {devWallet.solana_balance_in_lamports
                                        ? lamportsBNToSolDisplay(devWallet.solana_balance_in_lamports)
                                        : '—'}
                                </td>
                                <td className="px-3 py-2.5 text-right text-muted-foreground">—</td>
                                <td className="px-3 py-2.5 text-right text-muted-foreground">—</td>
                                <td className="px-3 py-2.5 text-right">
                                    <input
                                        type="number"
                                        min={0}
                                        step={0.000000001}
                                        placeholder="0.00"
                                        value={devWallet.id ? (buyAmounts[devWallet.id] ?? '') : ''}
                                        onChange={(e) => setBuyAmount(devWallet.id, e.target.value)}
                                        className="w-24 rounded border border-input bg-transparent px-2 py-1 text-right text-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                                    />
                                </td>
                            </tr>
                        )}

                        {/* Grouped wallet rows */}
                        {groups.map(({ type, wallets: groupWallets }) => (
                            <Fragment key={type.id}>
                                <tr className="border-b bg-muted/50">
                                    <td
                                        colSpan={6}
                                        className="px-3 py-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground"
                                    >
                                        {type.name}
                                    </td>
                                </tr>
                                {groupWallets.map((wallet) => {
                                    rowIndex++
                                    const n = rowIndex
                                    return (
                                        <tr
                                            key={wallet.id}
                                            className="border-b hover:bg-muted/30 transition-colors"
                                        >
                                            <td className="px-3 py-2.5 text-muted-foreground tabular-nums text-xs">
                                                {n}
                                            </td>
                                            <td className="px-3 py-2.5 font-mono text-xs">
                                                {maskPubKey(wallet.public_key)}
                                            </td>
                                            <td className="px-3 py-2.5 text-right text-muted-foreground tabular-nums text-xs">
                                                {wallet.solana_balance_in_lamports
                                                    ? lamportsBNToSolDisplay(wallet.solana_balance_in_lamports)
                                                    : '—'}
                                            </td>
                                            <td className="px-3 py-2.5 text-right text-muted-foreground text-xs">—</td>
                                            <td className="px-3 py-2.5 text-right text-muted-foreground text-xs">—</td>
                                            <td className="px-3 py-2.5 text-right">
                                                <input
                                                    type="number"
                                                    min={0}
                                                    step={0.000000001}
                                                    placeholder="0.00"
                                                    value={buyAmounts[wallet.id] ?? ''}
                                                    onChange={(e) => setBuyAmount(wallet.id, e.target.value)}
                                                    className="w-24 rounded border border-input bg-transparent px-2 py-1 text-right text-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                                                />
                                            </td>
                                        </tr>
                                    )
                                })}
                            </Fragment>
                        ))}

                        {groups.length === 0 && !devWallet && (
                            <tr>
                                <td colSpan={6} className="px-3 py-6 text-center text-sm text-muted-foreground">
                                    No wallets found.
                                </td>
                            </tr>
                        )}
                    </tbody>
                </table>
            </div>
        </div>
    )
}
