'use client'

import { useState, useEffect, useRef, useMemo, Fragment } from 'react'
import { WalletRecord } from '@/lib/types/wallet'
import { lamportsStringToBN } from '@/lib/lamports'

type WalletTypeRow = { id: string; name: string }

type WalletGroup = {
    id: string
    name: string
    color: string | null
    wallets: WalletRecord[]
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

export default function LookupTableBuilder() {
    const [wallets, setWallets]             = useState<WalletRecord[]>([])
    const [walletTypes, setWalletTypes]     = useState<WalletTypeRow[]>([])
    const [loading, setLoading]             = useState(true)
    const [activeFilters, setActiveFilters] = useState<string[]>([])
    const [selectedIds, setSelectedIds]     = useState<Set<string>>(new Set())
    const [building, setBuilding]           = useState(false)

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

    const visibleWallets = useMemo(() => {
        if (activeFilters.length === 0) return wallets
        return wallets.filter((w) => w.wallet_type_id != null && activeFilters.includes(w.wallet_type_id))
    }, [wallets, activeFilters])

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
        setSelectedIds(next)
    }

    function toggleGroup(groupWallets: WalletRecord[]) {
        const allSelected = groupWallets.every((w) => selectedIds.has(w.id))
        const next = new Set(selectedIds)
        if (allSelected) {
            groupWallets.forEach((w) => next.delete(w.id))
        } else {
            groupWallets.forEach((w) => next.add(w.id))
        }
        setSelectedIds(next)
    }

    function selectAll() {
        setSelectedIds(new Set(allVisibleIds))
    }

    function clearAll() {
        const next = new Set(selectedIds)
        allVisibleIds.forEach((id) => next.delete(id))
        setSelectedIds(next)
    }

    function handleBuild() {
        // wired up later
        setBuilding(true)
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
                <td colSpan={4} className="px-3 py-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
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
        const checked = selectedIds.has(wallet.id)
        return (
            <tr
                key={wallet.id}
                onClick={() => toggleWallet(wallet.id)}
                className={[
                    'border-b cursor-pointer transition-colors',
                    checked ? 'bg-blue-500/5 hover:bg-blue-500/10' : 'hover:bg-muted/30',
                ].join(' ')}
            >
                <td className="px-3 py-2.5 text-muted-foreground tabular-nums text-xs">{n}</td>
                <td className="px-3 py-2.5 font-mono text-xs">{maskPubKey(wallet.public_key)}</td>
                <td className="px-3 py-2.5 text-xs text-muted-foreground">
                    {wallet.label ?? <span className="opacity-40">—</span>}
                </td>
                <td className="px-3 py-2.5 text-xs text-muted-foreground">
                    {wallet.group_name
                        ? (
                            <span className="flex items-center gap-1.5">
                                {wallet.group_color && (
                                    <span
                                        className="inline-block size-1.5 rounded-full shrink-0"
                                        style={{ backgroundColor: wallet.group_color }}
                                    />
                                )}
                                {wallet.group_name}
                            </span>
                        )
                        : <span className="opacity-40">—</span>
                    }
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
        <div className="flex flex-col gap-6 p-6 w-full">

            <div>
                <h2 className="text-base font-semibold mb-1">Lookup Table Builder</h2>
                <p className="text-xs text-muted-foreground">
                    Select wallets to include in the address lookup table. Group headers can be clicked to select or deselect all wallets in that group.
                </p>
            </div>

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
                            <th className="px-3 py-2.5 text-left">Address</th>
                            <th className="px-3 py-2.5 text-left">Label</th>
                            <th className="px-3 py-2.5 text-left">Group</th>
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
                                {walletGroups.length > 0 && (
                                    <tr className="border-b bg-muted/30">
                                        <td colSpan={5} className="px-3 py-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground/60">
                                            Ungrouped
                                        </td>
                                    </tr>
                                )}
                                {ungrouped.map((wallet) => renderRow(wallet, ++rowIndex))}
                            </Fragment>
                        )}

                        {visibleWallets.length === 0 && (
                            <tr>
                                <td colSpan={5} className="px-3 py-6 text-center text-sm text-muted-foreground">
                                    No wallets found.
                                </td>
                            </tr>
                        )}
                    </tbody>
                </table>
            </div>

            {/* Footer */}
            <div className="flex items-center justify-between pt-2">
                <p className="text-xs text-muted-foreground">
                    {selectedIds.size > 0
                        ? `${selectedIds.size} wallet${selectedIds.size !== 1 ? 's' : ''} selected`
                        : 'No wallets selected'}
                </p>
                <button
                    onClick={handleBuild}
                    disabled={selectedIds.size === 0 || building}
                    className={[
                        'inline-flex items-center gap-2 rounded-md px-5 py-2 text-sm font-medium transition-colors',
                        selectedIds.size === 0 || building
                            ? 'bg-muted text-muted-foreground cursor-not-allowed border border-border'
                            : 'bg-blue-500 text-white hover:bg-blue-600 shadow-sm',
                    ].join(' ')}
                >
                    {building && (
                        <span className="size-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
                    )}
                    Build Lookup Table
                </button>
            </div>

        </div>
    )
}
