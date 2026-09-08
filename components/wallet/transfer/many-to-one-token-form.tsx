'use client'

import { useState, useEffect, useMemo, Fragment } from 'react'
import type { WalletRecord } from '@/lib/types/wallet'
import { Button } from '@/components/ui/button'
import { FieldLabel } from '@/components/ui/field'
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
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogDescription,
    DialogFooter,
    DialogClose,
} from '@/components/ui/dialog'
import {
    Tooltip,
    TooltipContent,
    TooltipProvider,
    TooltipTrigger,
} from '@/components/ui/tooltip'
import { Copy, ExternalLink } from 'lucide-react'
import TokenPicker, { type TokenPickerValue } from './token-picker'
import TransferProgressDialog, { type EdgeStatus } from './transfer-progress-dialog'

type WalletTypeRow = { id: string; name: string }

type WalletGroup = {
    id:      string
    name:    string
    color:   string | null
    wallets: WalletRecord[]
}

interface PendingEdge {
    fromWalletId:  string
    fromLabel:     string
    fromPublicKey: string
    toWalletId:    string
    toLabel:       string | null
    toAddress:     string
    amount:        string
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

/**
 * Many senders -> one fixed receiver. Uses the same generic
 * /api/wallet/transfer/token/many-to-many route as the many-to-many form —
 * every edge here just happens to share the same toWalletId/toAddress —
 * so this needed no new backend, only a form that fixes one side.
 */
export default function ManyToOneTokenForm() {
    const [wallets, setWallets]             = useState<WalletRecord[]>([])
    const [walletTypes, setWalletTypes]     = useState<WalletTypeRow[]>([])
    const [loading, setLoading]             = useState(true)
    const [activeFilters, setActiveFilters] = useState<string[]>([])

    const [receiverWalletId, setReceiverWalletId] = useState('')
    const [selectedSenders, setSelectedSenders]   = useState<Set<string>>(new Set())
    const [senderAmounts, setSenderAmounts]       = useState<Record<string, string>>({})

    const [token, setToken] = useState<TokenPickerValue>({ mintAddress: '', mintValid: false, tokenSymbol: null, logoUrl: null })
    // walletId -> ui-amount balance of the selected token, decimal-adjusted.
    const [tokenBalances, setTokenBalances]     = useState<Record<string, number>>({})
    const [balancesLoading, setBalancesLoading] = useState(false)

    const [pending, setPending]             = useState<PendingEdge[] | null>(null)
    const [activeEdges, setActiveEdges]     = useState<PendingEdge[] | null>(null)
    const [edgeStatuses, setEdgeStatuses]   = useState<EdgeStatus[]>([])
    const [showProgress, setShowProgress]   = useState(false)
    const [transfersDone, setTransfersDone] = useState(false)
    const [validationError, setValidationError] = useState('')
    const [copiedId, setCopiedId]           = useState<string | null>(null)

    useEffect(() => {
        fetch('/api/wallets/explorer')
            .then((r) => (r.ok ? r.json() : null))
            .then((data) => {
                if (!data) return
                setWallets((data.wallets ?? []) as WalletRecord[])
                setWalletTypes(data.walletTypes ?? [])
            })
            .catch(() => {})
            .finally(() => setLoading(false))
    }, [])

    // Clear sender selection when the receiver changes — a wallet picked as
    // a sender under the old receiver has nothing to do with the new one.
    useEffect(() => {
        setSelectedSenders(new Set())
        setSenderAmounts({})
    }, [receiverWalletId])

    useEffect(() => {
        setTokenBalances({})
        if (!token.mintValid || wallets.length === 0) return
        let cancelled = false
        setBalancesLoading(true)
        fetch('/api/wallet/token-balances', {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify({ mintAddress: token.mintAddress, walletAddresses: wallets.map((w) => w.public_key) }),
        })
            .then((r) => (r.ok ? r.json() : null))
            .then((data) => {
                if (cancelled || !data) return
                const decimals = data.decimals ?? 0
                const byId: Record<string, number> = {}
                for (const w of wallets) {
                    const raw = data.balances?.[w.public_key]
                    if (raw !== undefined) byId[w.id] = Number(raw) / 10 ** decimals
                }
                setTokenBalances(byId)
            })
            .catch(() => {})
            .finally(() => { if (!cancelled) setBalancesLoading(false) })
        return () => { cancelled = true }
    }, [token.mintValid, token.mintAddress, wallets])

    const symbolLabel = token.tokenSymbol ?? 'tokens'

    const receiverGroups = useMemo<[string, WalletRecord[]][]>(() => {
        const map: Record<string, WalletRecord[]> = {}
        for (const w of wallets) {
            const key = w.wallet_type ?? 'Other'
            ;(map[key] ??= []).push(w)
        }
        return Object.entries(map)
    }, [wallets])

    // Sender table — every wallet except the receiver, filtered by type.
    const visibleWallets = useMemo(() => {
        const withoutReceiver = wallets.filter((w) => w.id !== receiverWalletId)
        if (activeFilters.length === 0) return withoutReceiver
        return withoutReceiver.filter((w) => w.wallet_type_id != null && activeFilters.includes(w.wallet_type_id))
    }, [wallets, receiverWalletId, activeFilters])

    const walletGroups = useMemo<WalletGroup[]>(() => {
        const map = new Map<string, WalletGroup>()
        for (const w of visibleWallets) {
            if (!w.wallet_group_id || !w.group_name) continue
            if (!map.has(w.wallet_group_id)) {
                map.set(w.wallet_group_id, { id: w.wallet_group_id, name: w.group_name, color: w.group_color, wallets: [] })
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
        const next = new Set(selectedSenders)
        if (next.has(id)) {
            next.delete(id)
            setSenderAmounts((p) => { const n = { ...p }; delete n[id]; return n })
        } else {
            next.add(id)
        }
        setSelectedSenders(next)
    }

    function toggleGroup(groupWallets: WalletRecord[]) {
        const allSelected = groupWallets.every((w) => selectedSenders.has(w.id))
        const next = new Set(selectedSenders)
        if (allSelected) {
            groupWallets.forEach((w) => {
                next.delete(w.id)
                setSenderAmounts((p) => { const n = { ...p }; delete n[w.id]; return n })
            })
        } else {
            groupWallets.forEach((w) => next.add(w.id))
        }
        setSelectedSenders(next)
    }

    function selectAll() {
        const next = new Set(selectedSenders)
        allVisibleIds.forEach((id) => next.add(id))
        setSelectedSenders(next)
    }

    function clearAll() {
        const next = new Set(selectedSenders)
        allVisibleIds.forEach((id) => {
            next.delete(id)
            setSenderAmounts((p) => { const n = { ...p }; delete n[id]; return n })
        })
        setSelectedSenders(next)
    }

    // Fills one wallet's amount with its full live balance of the token.
    function setMaxForWallet(walletId: string) {
        const balance = tokenBalances[walletId]
        if (balance == null) return
        setSenderAmounts((p) => ({ ...p, [walletId]: String(balance) }))
    }

    // Fills every currently-SELECTED sender's amount with its own full
    // balance — not just the visible/filtered set, so toggling a type filter
    // afterward doesn't silently drop an amount someone already set.
    function setMaxForAllSelected() {
        setSenderAmounts((prev) => {
            const next = { ...prev }
            for (const id of selectedSenders) {
                const balance = tokenBalances[id]
                if (balance != null) next[id] = String(balance)
            }
            return next
        })
    }

    function handleSubmit() {
        setValidationError('')
        if (!receiverWalletId) { setValidationError('Select a receiver wallet.'); return }
        if (!token.mintValid) { setValidationError('Select a valid token.'); return }
        if (selectedSenders.size === 0) { setValidationError('Select at least one sender wallet.'); return }

        const receiver = wallets.find((w) => w.id === receiverWalletId)
        if (!receiver) { setValidationError('Select a receiver wallet.'); return }

        const senders = [...selectedSenders].map((id) => {
            const w = wallets.find((wl) => wl.id === id)!
            return { walletId: id, publicKey: w.public_key, label: w.label, amount: senderAmounts[id] ?? '' }
        })

        const missing = senders.filter((s) => !s.amount || parseFloat(s.amount) <= 0)
        if (missing.length > 0) {
            setValidationError('Enter an amount greater than 0 for all selected wallets.')
            return
        }

        setPending(senders.map((s) => ({
            fromWalletId:  s.walletId,
            fromLabel:     s.label ?? maskPubKey(s.publicKey),
            fromPublicKey: s.publicKey,
            toWalletId:    receiver.id,
            toLabel:       receiver.label,
            toAddress:     receiver.public_key,
            amount:        s.amount,
        })))
    }

    function resetAfterTransfer() {
        setShowProgress(false)
        setReceiverWalletId('')
        setSelectedSenders(new Set())
        setSenderAmounts({})
        setActiveFilters([])
        setActiveEdges(null)
        setEdgeStatuses([])
        setTransfersDone(false)
    }

    async function executeTransfers() {
        if (!pending) return
        const edges = pending
        setPending(null)

        setEdgeStatuses(edges.map(() => 'loading'))
        setActiveEdges(edges)
        setTransfersDone(false)
        setShowProgress(true)

        try {
            const res = await fetch('/api/wallet/transfer/token/many-to-many', {
                method:  'POST',
                headers: { 'Content-Type': 'application/json' },
                body:    JSON.stringify({
                    mintAddress: token.mintAddress,
                    transfers: edges.map((e) => ({
                        fromWalletId: e.fromWalletId,
                        toWalletId:   e.toWalletId,
                        toAddress:    e.toAddress,
                        amount:       parseFloat(e.amount),
                    })),
                }),
            })

            if (res.ok) {
                const { results } = await res.json()
                setEdgeStatuses((results as { success: boolean }[]).map((r) => (r.success ? 'success' : 'error')))
            } else {
                setEdgeStatuses(edges.map(() => 'error'))
            }
        } catch {
            setEdgeStatuses(edges.map(() => 'error'))
        }

        setTransfersDone(true)
    }

    async function retryEdge(index: number) {
        if (!activeEdges) return
        const edge = activeEdges[index]
        setEdgeStatuses((prev) => prev.map((s, i) => (i === index ? 'loading' : s)))

        let success = false
        try {
            const res = await fetch('/api/wallet/transfer/token/many-to-many', {
                method:  'POST',
                headers: { 'Content-Type': 'application/json' },
                body:    JSON.stringify({
                    mintAddress: token.mintAddress,
                    transfers: [{
                        fromWalletId: edge.fromWalletId,
                        toWalletId:   edge.toWalletId,
                        toAddress:    edge.toAddress,
                        amount:       parseFloat(edge.amount),
                    }],
                }),
            })
            if (res.ok) {
                const { results } = await res.json()
                success = results?.[0]?.success ?? false
            }
        } catch {
            success = false
        }

        setEdgeStatuses((prev) => prev.map((s, i) => (i === index ? (success ? 'success' : 'error') : s)))
    }

    function copyKey(e: React.MouseEvent, key: string, id: string) {
        e.stopPropagation()
        navigator.clipboard.writeText(key)
        setCopiedId(id)
        setTimeout(() => setCopiedId(null), 2000)
    }

    function renderGroupHeader(group: WalletGroup) {
        const allSelected  = group.wallets.every((w) => selectedSenders.has(w.id))
        const someSelected = !allSelected && group.wallets.some((w) => selectedSenders.has(w.id))
        return (
            <tr
                key={`group-${group.id}`}
                className="border-b bg-muted/50 cursor-pointer hover:bg-muted/70 transition-colors select-none"
                onClick={() => toggleGroup(group.wallets)}
            >
                <td colSpan={5} className="px-3 py-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    <span className="flex items-center gap-2">
                        {group.color && (
                            <span className="inline-block size-2 rounded-full shrink-0" style={{ backgroundColor: group.color }} />
                        )}
                        {group.name}
                        <span className="normal-case tracking-normal font-normal opacity-60">({group.wallets.length})</span>
                    </span>
                </td>
                <td className="px-3 py-2 text-right">
                    <span className={[
                        'inline-flex size-5 items-center justify-center rounded border-2 transition-colors',
                        allSelected  ? 'border-blue-500 bg-blue-500'
                        : someSelected ? 'border-blue-400 bg-blue-400/30'
                        : 'border-muted-foreground/40 hover:border-blue-400',
                    ].join(' ')}>
                        {allSelected ? <Checkmark /> : someSelected ? <Dash /> : null}
                    </span>
                </td>
            </tr>
        )
    }

    let rowIndex = 0

    function renderRow(wallet: WalletRecord, n: number) {
        const checked = selectedSenders.has(wallet.id)
        const balance = tokenBalances[wallet.id]
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
                <td className="px-3 py-2.5 font-mono text-xs">
                    <span className="flex items-center gap-1">
                        <span className="truncate">{maskPubKey(wallet.public_key)}</span>
                        <TooltipProvider>
                            <Tooltip open={copiedId === wallet.id ? true : undefined}>
                                <TooltipTrigger asChild>
                                    <span
                                        role="button"
                                        tabIndex={0}
                                        onClick={(e) => copyKey(e, wallet.public_key, wallet.id)}
                                        onKeyDown={(e) => e.key === 'Enter' && copyKey(e as never, wallet.public_key, wallet.id)}
                                        className="flex items-center justify-center rounded p-0.5 text-muted-foreground hover:text-foreground hover:bg-muted transition-colors cursor-pointer shrink-0"
                                        aria-label="Copy public key"
                                    >
                                        <Copy className="size-3" />
                                    </span>
                                </TooltipTrigger>
                                <TooltipContent side="top">
                                    {copiedId === wallet.id ? 'Copied to clipboard' : 'Copy address'}
                                </TooltipContent>
                            </Tooltip>
                        </TooltipProvider>
                        <TooltipProvider>
                            <Tooltip>
                                <TooltipTrigger asChild>
                                    <a
                                        href={`https://solscan.io/account/${wallet.public_key}`}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        onClick={(e) => e.stopPropagation()}
                                        className="flex items-center justify-center rounded p-0.5 text-muted-foreground hover:text-foreground hover:bg-muted transition-colors shrink-0"
                                        aria-label="View on Solscan"
                                    >
                                        <ExternalLink className="size-3" />
                                    </a>
                                </TooltipTrigger>
                                <TooltipContent side="top">View on Solscan</TooltipContent>
                            </Tooltip>
                        </TooltipProvider>
                    </span>
                </td>
                <td className="px-3 py-2.5 text-xs text-muted-foreground">
                    {wallet.label ?? <span className="opacity-40">—</span>}
                </td>
                <td className="px-3 py-2.5 text-right text-muted-foreground tabular-nums text-xs">
                    {!token.mintValid ? '—' : balancesLoading ? '…' : balance != null ? balance : '0'}
                </td>
                <td className="px-3 py-2.5 text-right" onClick={(e) => e.stopPropagation()}>
                    <div className="flex items-center justify-end gap-1">
                        <input
                            type="number"
                            min={0}
                            step="any"
                            placeholder="0.00"
                            value={senderAmounts[wallet.id] ?? ''}
                            onChange={(e) => setSenderAmounts((p) => ({ ...p, [wallet.id]: e.target.value }))}
                            className="w-24 rounded border border-input bg-transparent px-2 py-1 text-right text-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                        />
                        {token.mintValid && balance != null && (
                            <button
                                type="button"
                                onClick={() => setMaxForWallet(wallet.id)}
                                title="Use this wallet's full balance"
                                className="shrink-0 rounded border border-border px-1.5 py-1 text-[10px] font-medium text-muted-foreground hover:text-blue-500 hover:border-blue-500 transition-colors"
                            >
                                Max
                            </button>
                        )}
                    </div>
                </td>
                <td className="px-3 py-2.5 text-right">
                    <span
                        onClick={(e) => { e.stopPropagation(); toggleWallet(wallet.id) }}
                        className={[
                            'inline-flex size-5 cursor-pointer items-center justify-center rounded border-2 transition-colors',
                            checked ? 'border-blue-500 bg-blue-500' : 'border-muted-foreground/40 hover:border-blue-400',
                        ].join(' ')}
                    >
                        {checked && <Checkmark />}
                    </span>
                </td>
            </tr>
        )
    }

    if (loading) return <p className="text-sm text-muted-foreground py-4">Loading wallets…</p>

    const totalAmount = [...selectedSenders].reduce((sum, id) => {
        const v = parseFloat(senderAmounts[id] ?? '')
        return sum + (isNaN(v) ? 0 : v)
    }, 0)

    return (
        <>
            <div className="flex flex-col gap-6">

                {/* Token */}
                <div className="max-w-sm">
                    <TokenPicker onChange={setToken} />
                </div>

                {/* Receiver */}
                <div className="flex flex-col gap-1.5 max-w-sm">
                    <FieldLabel>Receiver Wallet</FieldLabel>
                    <Select value={receiverWalletId} onValueChange={setReceiverWalletId}>
                        <SelectTrigger>
                            <SelectValue placeholder="Select receiver wallet" />
                        </SelectTrigger>
                        <SelectContent>
                            {receiverGroups.map(([typeName, group], i) => (
                                <SelectGroup key={typeName}>
                                    {i > 0 && <SelectSeparator />}
                                    <SelectLabel>{typeName}</SelectLabel>
                                    {group.map((w) => (
                                        <SelectItem key={w.id} value={w.id}>
                                            {w.label ? `${w.label} · ` : ''}
                                            {maskPubKey(w.public_key)}
                                            {token.mintValid && tokenBalances[w.id] != null
                                                ? ` · ${tokenBalances[w.id]} ${symbolLabel}`
                                                : ''}
                                        </SelectItem>
                                    ))}
                                </SelectGroup>
                            ))}
                        </SelectContent>
                    </Select>
                </div>

                {/* Sender table */}
                <div className="flex flex-col gap-3">
                    <div className="flex items-center justify-between">
                        <FieldLabel>Sender Wallets</FieldLabel>
                        <button
                            type="button"
                            onClick={setMaxForAllSelected}
                            disabled={selectedSenders.size === 0 || !token.mintValid}
                            className="rounded border border-border px-2 py-1 text-[10px] font-medium text-muted-foreground hover:text-blue-500 hover:border-blue-500 transition-colors disabled:opacity-40 disabled:pointer-events-none"
                        >
                            Max All Selected
                        </button>
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
                    <div className="w-full overflow-x-auto overflow-y-auto max-h-[500px] rounded-md border">
                        <table className="w-full text-sm border-collapse">
                            <thead className="sticky top-0 z-10 bg-muted">
                                <tr className="border-b text-xs font-medium uppercase tracking-wider text-muted-foreground">
                                    <th className="px-3 py-2.5 text-left w-10">#</th>
                                    <th className="px-3 py-2.5 text-left">Public Key</th>
                                    <th className="px-3 py-2.5 text-left">Label</th>
                                    <th className="px-3 py-2.5 text-right">{symbolLabel} Balance</th>
                                    <th className="px-3 py-2.5 text-right">Amount ({symbolLabel})</th>
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
                                                <td colSpan={6} className="px-3 py-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground/60">
                                                    Ungrouped
                                                </td>
                                            </tr>
                                        )}
                                        {ungrouped.map((wallet) => renderRow(wallet, ++rowIndex))}
                                    </Fragment>
                                )}

                                {visibleWallets.length === 0 && (
                                    <tr>
                                        <td colSpan={6} className="px-3 py-6 text-center text-sm text-muted-foreground">
                                            {receiverWalletId ? 'No other wallets found.' : 'Select a receiver wallet to see senders.'}
                                        </td>
                                    </tr>
                                )}
                            </tbody>
                        </table>
                    </div>

                    {selectedSenders.size > 0 && (
                        <div className="flex items-center justify-between text-xs text-muted-foreground">
                            <span>{selectedSenders.size} wallet{selectedSenders.size !== 1 ? 's' : ''} selected</span>
                            {totalAmount > 0 && <span>Total: {totalAmount} {symbolLabel}</span>}
                        </div>
                    )}
                </div>

                {/* Validation error */}
                {validationError && (
                    <p className="text-sm text-destructive">{validationError}</p>
                )}

                {/* Submit */}
                <Button size="lg" variant="default" onClick={handleSubmit}>
                    Transfer
                </Button>
            </div>

            {/* Confirmation dialog */}
            <Dialog open={!!pending} onOpenChange={(open) => { if (!open) setPending(null) }}>
                <DialogContent className="max-w-md">
                    <DialogHeader>
                        <DialogTitle>Confirm Transfers</DialogTitle>
                        <DialogDescription>Review all {pending?.length ?? 0} transfers before sending.</DialogDescription>
                    </DialogHeader>

                    {pending && (
                        <div className="flex flex-col gap-3 text-sm">
                            <div className="flex justify-between text-muted-foreground">
                                <span>To</span>
                                <span className="font-mono text-foreground">
                                    {pending[0]?.toLabel ? `${pending[0].toLabel} · ` : ''}{maskPubKey(pending[0]?.toAddress ?? '')}
                                </span>
                            </div>

                            <div className="border-t pt-3 flex max-h-60 flex-col gap-2 overflow-y-auto">
                                {pending.map((e, i) => (
                                    <div key={i} className="flex justify-between">
                                        <span className="font-mono text-muted-foreground">{e.fromLabel}</span>
                                        <span className="font-semibold tabular-nums">{e.amount} {symbolLabel}</span>
                                    </div>
                                ))}
                            </div>

                            <div className="border-t pt-3 flex justify-between font-semibold">
                                <span>Total</span>
                                <span className="tabular-nums">
                                    {pending.reduce((s, e) => s + parseFloat(e.amount), 0)} {symbolLabel}
                                </span>
                            </div>
                        </div>
                    )}

                    <DialogFooter>
                        <DialogClose asChild>
                            <Button variant="outline">Cancel</Button>
                        </DialogClose>
                        <Button variant="default" onClick={executeTransfers}>
                            Confirm {pending?.length ?? 0} Transfer{(pending?.length ?? 0) !== 1 ? 's' : ''}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* Progress dialog */}
            <TransferProgressDialog
                open={showProgress}
                onOpenChange={(open) => { if (!open && transfersDone) resetAfterTransfer() }}
                edges={(activeEdges ?? []).map((e, i) => ({ key: i, fromLabel: e.fromLabel, toLabel: e.toLabel, toAddress: e.toAddress, amount: e.amount }))}
                statuses={edgeStatuses}
                symbolLabel={symbolLabel}
                done={transfersDone}
                onRetry={retryEdge}
                onDone={resetAfterTransfer}
            />
        </>
    )
}
