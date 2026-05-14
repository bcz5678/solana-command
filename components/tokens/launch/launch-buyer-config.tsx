'use client'

import { useState, useEffect, useMemo, Fragment } from 'react'
import { createClient } from '@/lib/supabase/client'
import { LaunchType } from '@/components/tokens/launch/types'
import { BuyerConfig } from '@/components//tokens/launch/buyer-config-class';
import { lamportsStringToBN, lamportsBNToSolDisplay, LAMPORTS_PER_SOL, SOL_DECIMALS } from '@/lib/lamports';

import BN from 'bn.js';

type Wallet = {
    id: number
    public_key: string
    wallet_type_id: number
    solana_balance_in_lamports: string
}

type WalletType = {
    id: number
    name: string
}

type Props = {
    launchBuyerConfig: BuyerConfig
    onBuyInputChange: (walletId: number, newAmount: string) => void
    onBuyInputReset: () => void
}

const supabase = createClient()


function maskPubKey(key: string) {
    return `${key.slice(0, 7)}....${key.slice(-7)}`
}

export default function LaunchBuyerConfig({ launchBuyerConfig, onBuyInputChange, onBuyInputReset }: Props) {
    const [wallets, setWallets] = useState<Wallet[]>([])
    const [walletTypes, setWalletTypes] = useState<WalletType[]>([])
    const [loading, setLoading] = useState(true)
    const [activeFilters, setActiveFilters] = useState<number[]>([])
    const [buyAmounts, setBuyAmounts] = useState<Record<number, string>>({})

    useEffect(() => {
        Promise.all([
            supabase.from('wallets').select('id, public_key, wallet_type_id, solana_balance_in_lamports'),
            supabase.from('wallet_type').select('id, name'),
        ]).then(([walletRes, typeRes]) => {

            if (walletRes.data) setWallets(walletRes.data.map((w) => ({ ...w, solana_balance_in_lamports: String(w.solana_balance_in_lamports ?? 0) })))
            if (typeRes.data) setWalletTypes(typeRes.data)
            setLoading(false)
        })
    }, [])

    const devWallet = useMemo(
        () => wallets.find((w) => w.id === launchBuyerConfig.devWalletId) ?? null,
        [wallets, launchBuyerConfig.devWalletId],
    )

    const otherWallets = useMemo(
        () => wallets.filter((w) => w.id !== launchBuyerConfig.devWalletId),
        [wallets, launchBuyerConfig.devWalletId],
    )

    const groups = useMemo(() => {
        const filtered =
            activeFilters.length > 0
                ? otherWallets.filter((w) => activeFilters.includes(w.wallet_type_id))
                : otherWallets
        return walletTypes
            .map((type) => ({
                type,
                wallets: filtered.filter((w) => w.wallet_type_id === type.id),
            }))
            .filter((g) => g.wallets.length > 0)
    }, [otherWallets, walletTypes, activeFilters])

    function toggleFilter(typeId: number) {
        setActiveFilters((prev) =>
            prev.includes(typeId) ? prev.filter((id) => id !== typeId) : [...prev, typeId],
        )
    }

    function setBuyAmount(walletId: number, newAmount: string) {
        onBuyInputChange(walletId, newAmount);
        setBuyAmounts((prev) => ({ ...prev, [walletId]: newAmount }))
    }

    function clearAll() {
        setBuyAmounts({});
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
                                    {lamportsBNToSolDisplay(lamportsStringToBN(devWallet.solana_balance_in_lamports))}
                                </td>
                                <td className="px-3 py-2.5 text-right text-muted-foreground">—</td>
                                <td className="px-3 py-2.5 text-right text-muted-foreground">—</td>
                                <td className="px-3 py-2.5 text-right">
                                    <input
                                        type="number"
                                        min={0}
                                        step={0.000000001}
                                        placeholder="0.00"
                                        value={buyAmounts[devWallet.id] ?? ''}
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
                                                {new BN(wallet.solana_balance_in_lamports).div(LAMPORTS_PER_SOL).toString()}
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
