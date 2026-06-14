'use client'

import { useState, useEffect, useRef, useMemo, Fragment } from 'react'
import { WalletRecord } from '@/lib/types/wallet'
import { lamportsBNToSolDisplay, lamportsStringToBN } from '@/lib/lamports'

type WalletTypeRow = { id: string; name: string }

type WalletGroup = {
    id: string
    name: string
    color: string | null
    wallets: WalletRecord[]
}

type Props = {
    selectedIds: Set<string>
    onSelectionChange: (ids: Set<string>) => void
    onTradeAmountChange: (walletId: string, amount: string) => void
    onTradeAmountReset: () => void
    defaultTypeName?: string
    tradeAmounts?: Record<string, string>
    errorIds?: Set<string>
    tradeType?: 'buy' | 'sell'
    tokenMint?: string
    onBalancesLoaded?: (balances: Record<string, string>, decimals: number) => void
}

function maskPubKey(key: string) {
    return `${key.slice(0, 7)}....${key.slice(-7)}`
}

function Checkmark() {
    return (
        <svg viewBox="0 0 10 8" fill="none" className="size-3 text-white" stroke="currentColor" strokeWidth={1.8}>
            <path d="M1 4l3 3 5-6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
    )
}

function Dash() {
    return <span className="block w-2.5 h-0.5 bg-white rounded" />
}

export default function StrategyWalletSelector({
    selectedIds,
    onSelectionChange,
    onTradeAmountChange,
    onTradeAmountReset,
    defaultTypeName,
    tradeAmounts: controlledTradeAmounts,
    errorIds,
    tradeType = 'buy',
    tokenMint,
    onBalancesLoaded,
}: Props) {
    const [wallets, setWallets]               = useState<WalletRecord[]>([])
    const [walletTypes, setWalletTypes]       = useState<WalletTypeRow[]>([])
    const [loading, setLoading]               = useState(true)
    const [refreshing, setRefreshing]         = useState(false)
    const [activeFilters, setActiveFilters]   = useState<string[]>([])
    const [localTradeAmounts, setLocalTradeAmounts] = useState<Record<string, string>>({})
    const tradeAmounts = controlledTradeAmounts ?? localTradeAmounts
    const didInit                             = useRef(false)

    const [tokenBalances, setTokenBalances]               = useState<Record<string, string>>({})
    const [tokenBalancesLoading, setTokenBalancesLoading] = useState(false)
    const [tokenDecimals, setTokenDecimals]               = useState(6)
    const onBalancesLoadedRef = useRef(onBalancesLoaded)
    useEffect(() => { onBalancesLoadedRef.current = onBalancesLoaded })

    function fetchWallets(isRefresh = false) {
        if (isRefresh) setRefreshing(true)
        else setLoading(true)
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
            })
            .catch(err => console.error('[wallets] fetch failed', err))
            .finally(() => {
                setLoading(false)
                setRefreshing(false)
            })
    }

    useEffect(() => { fetchWallets() }, [])

    // Auto-activate defaultTypeName filter once walletTypes load
    useEffect(() => {
        if (!defaultTypeName || walletTypes.length === 0 || didInit.current) return
        const match = walletTypes.find(
            (t) => t.name.toLowerCase() === defaultTypeName.toLowerCase(),
        )
        if (match) {
            setActiveFilters([match.id])
            didInit.current = true
        }
    }, [walletTypes, defaultTypeName])

    // Fetch token balances for sell mode — runs on the selector's own wallet list
    useEffect(() => {
        if (tradeType !== 'sell' || !tokenMint || wallets.length === 0) {
            setTokenBalances({})
            return
        }
        setTokenBalancesLoading(true)
        fetch('/api/wallet/token-balances', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ mintAddress: tokenMint, walletAddresses: wallets.map((w) => w.public_key) }),
        })
            .then((r) => r.ok ? r.json() : null)
            .then((data) => {
                if (!data) return
                setTokenDecimals(data.decimals ?? 6)
                const byId: Record<string, string> = {}
                for (const w of wallets) {
                    const bal = data.balances[w.public_key]
                    if (bal !== undefined) byId[w.id] = bal
                }
                setTokenBalances(byId)
                onBalancesLoadedRef.current?.(byId, data.decimals ?? 6)
            })
            .catch(() => {})
            .finally(() => setTokenBalancesLoading(false))
    }, [tradeType, tokenMint, wallets])

    const visibleWallets = useMemo(() => {
        if (activeFilters.length === 0) return wallets
        return wallets.filter((w) => w.wallet_type_id != null && activeFilters.includes(w.wallet_type_id))
    }, [wallets, activeFilters])

    // Group by wallet_group (not wallet_type)
    const walletGroups = useMemo<WalletGroup[]>(() => {
        const map = new Map<string, WalletGroup>()
        for (const w of visibleWallets) {
            if (!w.wallet_group_id || !w.group_name) continue
            if (!map.has(w.wallet_group_id)) {
                map.set(w.wallet_group_id, {
                    id: w.wallet_group_id,
                    name: w.group_name,
                    color: w.group_color,
                    wallets: [],
                })
            }
            map.get(w.wallet_group_id)!.wallets.push(w)
        }
        return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name))
    }, [visibleWallets])

    const ungrouped = useMemo(
        () => visibleWallets.filter((w) => !w.wallet_group_id),
        [visibleWallets],
    )

    const allVisibleIds = useMemo(() => visibleWallets.map((w) => w.id), [visibleWallets])

    function toggleFilter(typeId: string) {
        setActiveFilters((prev) =>
            prev.includes(typeId) ? prev.filter((id) => id !== typeId) : [...prev, typeId],
        )
    }

    function toggleWallet(id: string) {
        const next = new Set(selectedIds)
        if (next.has(id)) next.delete(id)
        else next.add(id)
        onSelectionChange(next)
    }

    function toggleGroup(groupWallets: WalletRecord[]) {
        const allSelected = groupWallets.every((w) => selectedIds.has(w.id))
        const next = new Set(selectedIds)
        if (allSelected) {
            groupWallets.forEach((w) => next.delete(w.id))
        } else {
            groupWallets.forEach((w) => next.add(w.id))
        }
        onSelectionChange(next)
    }

    function selectAll() {
        const next = new Set(selectedIds)
        allVisibleIds.forEach((id) => next.add(id))
        onSelectionChange(next)
    }

    function clearAll() {
        const next = new Set(selectedIds)
        allVisibleIds.forEach((id) => next.delete(id))
        onSelectionChange(next)
    }

    function setTradeAmount(walletId: string, amount: string) {
        onTradeAmountChange(walletId, amount)
        if (!controlledTradeAmounts) setLocalTradeAmounts((prev) => ({ ...prev, [walletId]: amount }))
    }

    function clearTradeAmounts() {
        setLocalTradeAmounts({})
        onTradeAmountReset()
    }

    if (loading) return <p className="text-sm text-muted-foreground py-4">Loading wallets…</p>

    function renderGroupHeader(group: WalletGroup) {
        const allSelected  = group.wallets.every((w) => selectedIds.has(w.id))
        const someSelected = !allSelected && group.wallets.some((w) => selectedIds.has(w.id))
        return (
            <tr
                key={`group-${group.id}`}
                className="border-b bg-muted/50 cursor-pointer hover:bg-muted/70 transition-colors select-none"
                onClick={() => toggleGroup(group.wallets)}
            >
                <td colSpan={7} className="px-3 py-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    <span className="flex items-center gap-2">
                        {group.color && (
                            <span
                                className="inline-block size-2 rounded-full shrink-0"
                                style={{ backgroundColor: group.color }}
                            />
                        )}
                        {group.name}
                        <span className="normal-case tracking-normal font-normal opacity-60">
                            ({group.wallets.length})
                        </span>
                    </span>
                </td>
                <td className="px-3 py-2 text-right">
                    <span
                        className={[
                            'inline-flex size-5 items-center justify-center rounded border-2 transition-colors',
                            allSelected
                                ? 'border-blue-500 bg-blue-500'
                                : someSelected
                                ? 'border-blue-400 bg-blue-400/30'
                                : 'border-muted-foreground/40 hover:border-blue-400',
                        ].join(' ')}
                    >
                        {allSelected ? <Checkmark /> : someSelected ? <Dash /> : null}
                    </span>
                </td>
            </tr>
        )
    }

    function renderRow(wallet: WalletRecord, n: number) {
        const checked  = selectedIds.has(wallet.id)
        const hasError = errorIds?.has(wallet.id) ?? false
        return (
            <tr
                key={wallet.id}
                onClick={() => toggleWallet(wallet.id)}
                className={[
                    'border-b cursor-pointer transition-colors',
                    hasError
                        ? 'bg-destructive/5 hover:bg-destructive/10 outline-1 outline-destructive/40 -outline-offset-1'
                        : checked
                        ? 'bg-blue-500/5 hover:bg-blue-500/10'
                        : 'hover:bg-muted/30',
                ].join(' ')}
            >
                <td className="px-3 py-2.5 text-muted-foreground tabular-nums text-xs">{n}</td>
                <td className="px-3 py-2.5 font-mono text-xs">{maskPubKey(wallet.public_key)}</td>
                <td className="px-3 py-2.5 text-xs text-muted-foreground">
                    {wallet.label ?? <span className="opacity-40">—</span>}
                </td>
                <td className="px-3 py-2.5 text-right text-muted-foreground tabular-nums text-xs">
                    {wallet.solana_balance_in_lamports
                        ? lamportsBNToSolDisplay(wallet.solana_balance_in_lamports)
                        : '—'}
                </td>
                <td className="px-3 py-2.5 text-right tabular-nums text-xs text-muted-foreground">
                    {tradeType === 'sell'
                        ? tokenBalancesLoading
                            ? <span className="inline-block size-3 rounded-full border-2 border-muted-foreground/30 border-t-muted-foreground animate-spin" />
                            : (() => {
                                const raw = tokenBalances?.[wallet.id]
                                if (!raw) return '—'
                                const ui = Number(raw) / Math.pow(10, tokenDecimals)
                                return ui.toLocaleString(undefined, { maximumFractionDigits: Math.min(tokenDecimals, 6) })
                            })()
                        : '—'}
                </td>
                <td className="px-3 py-2.5 text-right text-muted-foreground text-xs">—</td>
                <td className="px-3 py-2.5 text-right" onClick={(e) => e.stopPropagation()}>
                    <input
                        type="number"
                        min={0}
                        step={0.000000001}
                        placeholder="0.00"
                        value={tradeAmounts[wallet.id] ?? ''}
                        onChange={(e) => setTradeAmount(wallet.id, e.target.value)}
                        className="w-24 rounded border border-input bg-transparent px-2 py-1 text-right text-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                    />
                </td>
                <td className="px-3 py-2.5 text-right">
                    <span
                        onClick={(e) => { e.stopPropagation(); toggleWallet(wallet.id) }}
                        className={[
                            'inline-flex size-5 cursor-pointer items-center justify-center rounded border-2 transition-colors',
                            checked
                                ? 'border-blue-500 bg-blue-500'
                                : 'border-muted-foreground/40 hover:border-blue-400',
                        ].join(' ')}
                    >
                        {checked && <Checkmark />}
                    </span>
                </td>
            </tr>
        )
    }

    let rowIndex = 0

    return (
        <div className="flex flex-col gap-4">
            {/* Type filter chips */}
            <div className="flex flex-wrap items-center gap-2">
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
                <button
                    onClick={() => fetchWallets(true)}
                    disabled={refreshing}
                    title="Refresh wallets & balances"
                    className="ml-auto flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs border border-border text-muted-foreground hover:text-foreground hover:border-foreground/40 transition-colors disabled:opacity-40"
                >
                    <svg
                        className={['size-3', refreshing ? 'animate-spin' : ''].join(' ')}
                        viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"
                        strokeLinecap="round" strokeLinejoin="round"
                    >
                        <path d="M21 2v6h-6" /><path d="M3 12a9 9 0 0 1 15-6.7L21 8" />
                        <path d="M3 22v-6h6" /><path d="M21 12a9 9 0 0 1-15 6.7L3 16" />
                    </svg>
                    {refreshing ? 'Refreshing…' : 'Refresh'}
                </button>
            </div>

            {/* Table */}
            <div className="w-full overflow-x-auto overflow-y-auto max-h-[600px] rounded-md border">
                <table className="w-full text-sm border-collapse">
                    <thead className="sticky top-0 z-10 bg-muted">
                        <tr className="border-b text-xs font-medium uppercase tracking-wider text-muted-foreground">
                            <th className="px-3 py-2.5 text-left w-10">#</th>
                            <th className="px-3 py-2.5 text-left">Public Key</th>
                            <th className="px-3 py-2.5 text-left">Label</th>
                            <th className="px-3 py-2.5 text-right">SOL Balance</th>
                            <th className="px-3 py-2.5 text-right">Token Amount</th>
                            <th className="px-3 py-2.5 text-right">% Supply</th>
                            <th className="px-3 py-2.5 text-right">
                                <div className="flex items-center justify-end gap-2">
                                    {tradeType === 'sell' ? 'Token to Trade' : 'SOL to Trade'}
                                    <button
                                        onClick={clearTradeAmounts}
                                        className="normal-case tracking-normal font-normal text-[10px] border border-border rounded px-1.5 py-0.5 text-muted-foreground hover:text-destructive hover:border-destructive transition-colors"
                                    >
                                        Clear all
                                    </button>
                                </div>
                            </th>
                            <th className="px-3 py-2.5 text-right">
                                <div className="flex items-center justify-end gap-2">
                                    Include
                                    <span className="flex gap-1 normal-case tracking-normal font-normal">
                                        <button
                                            onClick={selectAll}
                                            className="text-[10px] border border-border rounded px-1.5 py-0.5 text-muted-foreground hover:text-blue-500 hover:border-blue-500 transition-colors"
                                        >
                                            All
                                        </button>
                                        <button
                                            onClick={clearAll}
                                            className="text-[10px] border border-border rounded px-1.5 py-0.5 text-muted-foreground hover:text-destructive hover:border-destructive transition-colors"
                                        >
                                            Clear
                                        </button>
                                    </span>
                                </div>
                            </th>
                        </tr>
                    </thead>
                    <tbody>
                        {walletGroups.map((group) => (
                            <Fragment key={group.id}>
                                {renderGroupHeader(group)}
                                {group.wallets.map((wallet) => renderRow(wallet, ++rowIndex))}
                            </Fragment>
                        ))}

                        {ungrouped.length > 0 && (
                            <Fragment>
                                {ungrouped.length > 0 && walletGroups.length > 0 && (
                                    <tr className="border-b bg-muted/30">
                                        <td colSpan={8} className="px-3 py-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground/60">
                                            Ungrouped
                                        </td>
                                    </tr>
                                )}
                                {ungrouped.map((wallet) => renderRow(wallet, ++rowIndex))}
                            </Fragment>
                        )}

                        {visibleWallets.length === 0 && (
                            <tr>
                                <td colSpan={8} className="px-3 py-6 text-center text-sm text-muted-foreground">
                                    No wallets found.
                                </td>
                            </tr>
                        )}
                    </tbody>
                </table>
            </div>

            {selectedIds.size > 0 && (
                <p className="text-xs text-muted-foreground">
                    {selectedIds.size} wallet{selectedIds.size !== 1 ? 's' : ''} selected
                </p>
            )}
        </div>
    )
}
