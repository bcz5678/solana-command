'use client'

import { useState, useEffect, useMemo, Fragment } from 'react'
import { WalletRecord } from '@/lib/types/wallet'
import { lamportsStringToBN, lamportsBNToSolDisplay } from '@/lib/lamports'

type BuildSuccess = {
    altAddress:   string
    addressCount: number
    explorerUrl:  string
}
import { Input } from '@/components/ui/input'
import { FieldLabel, FieldDescription } from '@/components/ui/field'
import {
    Select,
    SelectContent,
    SelectGroup,
    SelectItem,
    SelectLabel,
    SelectSeparator,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select'

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
    const [tableName, setTableName]         = useState('')
    const [signerWalletId, setSignerWalletId] = useState('')
    const [building, setBuilding]       = useState(false)
    const [buildError, setBuildError]   = useState<string | null>(null)
    const [buildResult, setBuildResult] = useState<BuildSuccess | null>(null)

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

    const signerGroups = useMemo<[string, WalletRecord[]][]>(() => {
        const withSol = wallets.filter(
            (w) => w.solana_balance_in_lamports != null && w.solana_balance_in_lamports.gtn(0),
        )
        const map: Record<string, WalletRecord[]> = {}
        for (const w of withSol) {
            const key = w.wallet_type ?? 'Other'
            ;(map[key] ??= []).push(w)
        }
        return Object.entries(map)
    }, [wallets])

    function toggleFilter(typeId: string) {
        setActiveFilters((prev) =>
            prev.includes(typeId) ? prev.filter((id) => id !== typeId) : [...prev, typeId],
        )
    }

    const MAX_WALLETS = 20
    const overLimit = selectedIds.size > MAX_WALLETS

    function toggleWallet(id: string) {
        const next = new Set(selectedIds)
        if (next.has(id)) {
            next.delete(id)
        } else {
            if (next.size >= MAX_WALLETS) return
            next.add(id)
        }
        setSelectedIds(next)
    }

    function toggleGroup(groupWallets: WalletRecord[]) {
        const allSelected = groupWallets.every((w) => selectedIds.has(w.id))
        const next = new Set(selectedIds)
        if (allSelected) {
            groupWallets.forEach((w) => next.delete(w.id))
        } else {
            for (const w of groupWallets) {
                if (next.size >= MAX_WALLETS) break
                next.add(w.id)
            }
        }
        setSelectedIds(next)
    }

    function selectAll() {
        const next = new Set<string>()
        for (const id of allVisibleIds) {
            if (next.size >= MAX_WALLETS) break
            next.add(id)
        }
        setSelectedIds(next)
    }

    function clearAll() {
        const next = new Set(selectedIds)
        allVisibleIds.forEach((id) => next.delete(id))
        setSelectedIds(next)
    }

    async function handleBuild() {
        if (!signerWalletId) return

        const walletsToAdd = wallets
            .filter((w) => selectedIds.has(w.id))
            .map((w) => w.public_key)

        setBuilding(true)
        setBuildError(null)
        setBuildResult(null)

        try {
            const res = await fetch('/api/lookup-table/create', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    displayName:       tableName,
                    authorityWalletId: signerWalletId,
                    addresses:         walletsToAdd,
                }),
            })
            const json = await res.json()
            if (res.status === 201) {
                setBuildResult({
                    altAddress:   json.altAddress,
                    addressCount: json.addressCount,
                    explorerUrl:  json.explorerUrl,
                })
            } else {
                setBuildError(json.error ?? 'Failed to build lookup table')
            }
        } catch (err) {
            setBuildError(err instanceof Error ? err.message : 'Request failed')
        } finally {
            setBuilding(false)
        }
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

            {/* Page header */}
            <div>
                <h2 className="text-base font-semibold mb-1">Lookup Table Builder</h2>
                <p className="text-xs text-muted-foreground">
                    Configure and build an on-chain address lookup table (ALT) from your wallets.
                </p>
            </div>

            {/* Config */}
            <div className="rounded-lg border border-border bg-card p-4 flex flex-col gap-4">
                <h3 className="text-sm font-semibold text-foreground">Configuration</h3>
                <div className="flex flex-col gap-1.5 max-w-sm">
                    <label htmlFor="lut-name" className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                        Table Name
                    </label>
                    <Input
                        id="lut-name"
                        placeholder="e.g. Trading Wallets ALT"
                        value={tableName}
                        onChange={(e) => setTableName(e.target.value)}
                    />
                    <p className="text-[11px] text-muted-foreground">
                        A label for this lookup table — stored locally for reference.
                    </p>
                </div>

                <div className="flex flex-col gap-1.5 max-w-sm">
                    <FieldLabel htmlFor="lut-signer">Payer / Signer Wallet</FieldLabel>
                    <Select value={signerWalletId} onValueChange={setSignerWalletId}>
                        <SelectTrigger id="lut-signer">
                            <SelectValue placeholder="Select a wallet" />
                        </SelectTrigger>
                        <SelectContent>
                            {signerGroups.map(([typeName, group], i) => (
                                <SelectGroup key={typeName}>
                                    {i > 0 && <SelectSeparator />}
                                    <SelectLabel>{typeName}</SelectLabel>
                                    {group.map((w) => (
                                        <SelectItem key={w.id} value={w.id}>
                                            {w.label ? `${w.label} · ` : ''}
                                            {maskPubKey(w.public_key)}
                                            {' · '}
                                            {lamportsBNToSolDisplay(w.solana_balance_in_lamports!)} SOL
                                        </SelectItem>
                                    ))}
                                </SelectGroup>
                            ))}
                            {signerGroups.length === 0 && (
                                <div className="px-3 py-4 text-center text-xs text-muted-foreground">
                                    No wallets with SOL found
                                </div>
                            )}
                        </SelectContent>
                    </Select>
                    <FieldDescription>
                        This wallet pays rent and transaction fees. Must have SOL.
                    </FieldDescription>
                </div>
            </div>

            {/* Wallet selection header */}
            <div className="flex items-center gap-3">
                <h3 className="text-sm font-semibold text-foreground shrink-0">Wallet Selection</h3>
                <div className="flex-1 h-px bg-border" />
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

            {/* Over-limit error */}
            {overLimit && (
                <div className="flex items-start gap-2.5 rounded-md border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
                    <svg className="mt-0.5 size-4 shrink-0" viewBox="0 0 20 20" fill="currentColor">
                        <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
                    </svg>
                    <span>
                        <strong>{selectedIds.size} wallets selected</strong> — address lookup tables support a maximum of{' '}
                        <strong>{MAX_WALLETS} addresses</strong> due to Solana transaction size limits. Deselect{' '}
                        {selectedIds.size - MAX_WALLETS} wallet{selectedIds.size - MAX_WALLETS !== 1 ? 's' : ''} to continue.
                    </span>
                </div>
            )}

            {/* Build error */}
            {buildError && (
                <div className="flex items-start gap-2.5 rounded-md border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
                    <svg className="mt-0.5 size-4 shrink-0" viewBox="0 0 20 20" fill="currentColor">
                        <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
                    </svg>
                    <span>{buildError}</span>
                </div>
            )}

            {/* Build success */}
            {buildResult && (
                <div className="flex items-start gap-2.5 rounded-md border border-green-500/40 bg-green-500/10 px-4 py-3 text-sm text-green-700 dark:text-green-400">
                    <svg className="mt-0.5 size-4 shrink-0" viewBox="0 0 20 20" fill="currentColor">
                        <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                    </svg>
                    <span>
                        Lookup table created —{' '}
                        <span className="font-mono">{buildResult.altAddress}</span>
                        {buildResult.addressCount > 0 && ` · ${buildResult.addressCount} addresses added`}
                        {buildResult.explorerUrl && (
                            <>
                                {' · '}
                                <a
                                    href={buildResult.explorerUrl}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="underline underline-offset-2 hover:opacity-80"
                                >
                                    View on Explorer
                                </a>
                            </>
                        )}
                    </span>
                </div>
            )}

            {/* Footer */}
            <div className="flex items-center justify-between pt-2">
                <p className="text-xs text-muted-foreground">
                    {selectedIds.size > 0
                        ? `${selectedIds.size} / ${MAX_WALLETS} wallets selected`
                        : 'No wallets selected'}
                </p>
                <button
                    onClick={handleBuild}
                    disabled={selectedIds.size === 0 || overLimit || !signerWalletId || building}
                    className={[
                        'inline-flex items-center gap-2 rounded-md px-5 py-2 text-sm font-medium transition-colors',
                        selectedIds.size === 0 || overLimit || !signerWalletId || building
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
