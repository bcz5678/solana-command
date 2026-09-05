'use client'

import { useState, useEffect, useMemo, Fragment } from "react";
import type { WalletRecord } from "@/lib/types/wallet";
import { Button } from "@/components/ui/button";
import { FieldLabel } from "@/components/ui/field";
import {
    Select,
    SelectContent,
    SelectGroup,
    SelectItem,
    SelectLabel,
    SelectSeparator,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogDescription,
    DialogFooter,
    DialogClose,
} from "@/components/ui/dialog";
import {
    Tooltip,
    TooltipContent,
    TooltipProvider,
    TooltipTrigger,
} from "@/components/ui/tooltip";
import { Copy, ExternalLink } from "lucide-react";
import TokenPicker, { type TokenPickerValue } from './token-picker'

type WalletTypeRow = { id: string; name: string };

type WalletGroup = {
    id: string
    name: string
    color: string | null
    wallets: WalletRecord[]
}

type TransferStatus = 'pending' | 'loading' | 'success' | 'error'

type PendingTransfer = {
    senderWalletId:  string
    senderPublicKey: string
    senderLabel:     string | null
    receivers:       { walletId: string; publicKey: string; label: string | null; amount: string }[]
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

export default function FundOneToManyTokenForm() {
    const [wallets, setWallets]                   = useState<WalletRecord[]>([])
    const [walletTypes, setWalletTypes]           = useState<WalletTypeRow[]>([])
    const [loading, setLoading]                   = useState(true)
    const [activeFilters, setActiveFilters]       = useState<string[]>([])
    const [senderWalletId, setSenderWalletId]     = useState('')
    const [selectedReceivers, setSelectedReceivers] = useState<Set<string>>(new Set())
    const [receiverAmounts, setReceiverAmounts]   = useState<Record<string, string>>({})
    const [pending, setPending]                   = useState<PendingTransfer | null>(null)
    const [activeTransfer, setActiveTransfer]     = useState<PendingTransfer | null>(null)
    const [showProgress, setShowProgress]         = useState(false)
    const [receiverStatuses, setReceiverStatuses] = useState<Record<string, TransferStatus>>({})
    const [transfersDone, setTransfersDone]       = useState(false)
    const [validationError, setValidationError]   = useState('')
    const [copiedId, setCopiedId]                  = useState<string | null>(null)

    const [token, setToken] = useState<TokenPickerValue>({ mintAddress: '', mintValid: false, tokenSymbol: null, logoUrl: null })
    // walletId -> ui-amount balance of the selected token, decimal-adjusted.
    const [tokenBalances, setTokenBalances]     = useState<Record<string, number>>({})
    const [balancesLoading, setBalancesLoading] = useState(false)

    useEffect(() => {
        fetch('/api/wallets/explorer')
            .then((r) => r.ok ? r.json() : null)
            .then((data) => {
                if (!data) return
                setWallets((data.wallets ?? []) as WalletRecord[])
                setWalletTypes(data.walletTypes ?? [])
            })
            .catch(err => console.error('[wallets] fetch failed', err))
            .finally(() => setLoading(false))
    }, [])

    // Clear receiver selection when sender changes
    useEffect(() => {
        setSelectedReceivers(new Set())
        setReceiverAmounts({})
    }, [senderWalletId])

    // Fetch every wallet's balance of the selected token whenever it changes.
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

    // Sender dropdown — all wallets grouped by type
    const senderGroups = useMemo<[string, WalletRecord[]][]>(() => {
        const map: Record<string, WalletRecord[]> = {}
        for (const w of wallets) {
            const key = w.wallet_type ?? 'Other'
            ;(map[key] ??= []).push(w)
        }
        return Object.entries(map)
    }, [wallets])

    // Receiver table — all wallets except the sender, filtered by type
    const visibleWallets = useMemo(() => {
        const withoutSender = wallets.filter((w) => w.id !== senderWalletId)
        if (activeFilters.length === 0) return withoutSender
        return withoutSender.filter((w) => w.wallet_type_id != null && activeFilters.includes(w.wallet_type_id))
    }, [wallets, senderWalletId, activeFilters])

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
        const next = new Set(selectedReceivers)
        if (next.has(id)) {
            next.delete(id)
            setReceiverAmounts((p) => { const n = { ...p }; delete n[id]; return n })
        } else {
            next.add(id)
        }
        setSelectedReceivers(next)
    }

    function toggleGroup(groupWallets: WalletRecord[]) {
        const allSelected = groupWallets.every((w) => selectedReceivers.has(w.id))
        const next = new Set(selectedReceivers)
        if (allSelected) {
            groupWallets.forEach((w) => {
                next.delete(w.id)
                setReceiverAmounts((p) => { const n = { ...p }; delete n[w.id]; return n })
            })
        } else {
            groupWallets.forEach((w) => next.add(w.id))
        }
        setSelectedReceivers(next)
    }

    function selectAll() {
        const next = new Set(selectedReceivers)
        allVisibleIds.forEach((id) => next.add(id))
        setSelectedReceivers(next)
    }

    function clearAll() {
        const next = new Set(selectedReceivers)
        allVisibleIds.forEach((id) => {
            next.delete(id)
            setReceiverAmounts((p) => { const n = { ...p }; delete n[id]; return n })
        })
        setSelectedReceivers(next)
    }

    function handleSubmit() {
        setValidationError('')
        if (!senderWalletId) { setValidationError('Select a sender wallet.'); return }
        if (!token.mintValid) { setValidationError('Select a valid token.'); return }
        if (selectedReceivers.size === 0) { setValidationError('Select at least one receiver wallet.'); return }

        const receivers = [...selectedReceivers].map((id) => {
            const w = wallets.find((w) => w.id === id)!
            return { walletId: id, publicKey: w.public_key, label: w.label, amount: receiverAmounts[id] ?? '' }
        })

        const missing = receivers.filter((r) => !r.amount || parseFloat(r.amount) <= 0)
        if (missing.length > 0) {
            setValidationError(`Enter an amount greater than 0 for all selected wallets.`)
            return
        }

        const sender = wallets.find((w) => w.id === senderWalletId)!
        setPending({ senderWalletId, senderPublicKey: sender.public_key, senderLabel: sender.label, receivers })
    }

    function resetAfterTransfer() {
        setShowProgress(false)
        setSenderWalletId('')
        setSelectedReceivers(new Set())
        setReceiverAmounts({})
        setActiveFilters([])
        setActiveTransfer(null)
        setReceiverStatuses({})
        setTransfersDone(false)
    }

    async function executeTransfers() {
        if (!pending) return
        const transfer = pending
        setPending(null)

        const initial: Record<string, TransferStatus> = {}
        transfer.receivers.forEach((r) => { initial[r.walletId] = 'loading' })
        setReceiverStatuses(initial)
        setActiveTransfer(transfer)
        setTransfersDone(false)
        setShowProgress(true)

        try {
            const res = await fetch('/api/wallet/transfer/token/fund', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    senderWalletId: transfer.senderWalletId,
                    mintAddress:    token.mintAddress,
                    receivers: transfer.receivers.map((r) => ({
                        walletId:  r.walletId,
                        publicKey: r.publicKey,
                        amount:    parseFloat(r.amount),
                    })),
                }),
            })

            if (res.ok) {
                const { results } = await res.json()
                const updated: Record<string, TransferStatus> = {}
                for (const result of results as { walletId: string; success: boolean }[]) {
                    updated[result.walletId] = result.success ? 'success' : 'error'
                }
                setReceiverStatuses(updated)
            } else {
                const failed: Record<string, TransferStatus> = {}
                transfer.receivers.forEach((r) => { failed[r.walletId] = 'error' })
                setReceiverStatuses(failed)
            }
        } catch {
            const failed: Record<string, TransferStatus> = {}
            transfer.receivers.forEach((r) => { failed[r.walletId] = 'error' })
            setReceiverStatuses(failed)
        }

        setTransfersDone(true)
    }

    function copyKey(e: React.MouseEvent, key: string, id: string) {
        e.stopPropagation()
        navigator.clipboard.writeText(key)
        setCopiedId(id)
        setTimeout(() => setCopiedId(null), 2000)
    }

    function renderGroupHeader(group: WalletGroup) {
        const allSelected  = group.wallets.every((w) => selectedReceivers.has(w.id))
        const someSelected = !allSelected && group.wallets.some((w) => selectedReceivers.has(w.id))
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
        const checked = selectedReceivers.has(wallet.id)
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
                    <input
                        type="number"
                        min={0}
                        step="any"
                        placeholder="0.00"
                        value={receiverAmounts[wallet.id] ?? ''}
                        onChange={(e) => setReceiverAmounts((p) => ({ ...p, [wallet.id]: e.target.value }))}
                        className="w-24 rounded border border-input bg-transparent px-2 py-1 text-right text-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                    />
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

    const totalAmount = [...selectedReceivers].reduce((sum, id) => {
        const v = parseFloat(receiverAmounts[id] ?? '')
        return sum + (isNaN(v) ? 0 : v)
    }, 0)

    return (
        <>
            <div className="flex flex-col gap-6">

                {/* Token */}
                <div className="max-w-sm">
                    <TokenPicker onChange={setToken} />
                </div>

                {/* Sender */}
                <div className="flex flex-col gap-1.5 max-w-sm">
                    <FieldLabel>Sender Wallet</FieldLabel>
                    <Select value={senderWalletId} onValueChange={setSenderWalletId}>
                        <SelectTrigger>
                            <SelectValue placeholder="Select sender wallet" />
                        </SelectTrigger>
                        <SelectContent>
                            {senderGroups.map(([typeName, group], i) => (
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

                {/* Receiver table */}
                <div className="flex flex-col gap-3">
                    <FieldLabel>Receiver Wallets</FieldLabel>

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
                                            {senderWalletId ? 'No other wallets found.' : 'Select a sender wallet to see receivers.'}
                                        </td>
                                    </tr>
                                )}
                            </tbody>
                        </table>
                    </div>

                    {selectedReceivers.size > 0 && (
                        <div className="flex items-center justify-between text-xs text-muted-foreground">
                            <span>{selectedReceivers.size} wallet{selectedReceivers.size !== 1 ? 's' : ''} selected</span>
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
                        <DialogDescription>Review all transfers before sending.</DialogDescription>
                    </DialogHeader>

                    {pending && (
                        <div className="flex flex-col gap-3 text-sm">
                            <div className="flex justify-between text-muted-foreground">
                                <span>From</span>
                                <span className="font-mono text-foreground">
                                    {pending.senderLabel ? `${pending.senderLabel} · ` : ''}{maskPubKey(pending.senderPublicKey)}
                                </span>
                            </div>

                            <div className="border-t pt-3 flex flex-col gap-2">
                                {pending.receivers.map((r) => (
                                    <div key={r.walletId} className="flex justify-between">
                                        <span className="font-mono text-muted-foreground">
                                            {r.label ? `${r.label} · ` : ''}{maskPubKey(r.publicKey)}
                                        </span>
                                        <span className="font-semibold tabular-nums">{r.amount} {symbolLabel}</span>
                                    </div>
                                ))}
                            </div>

                            <div className="border-t pt-3 flex justify-between font-semibold">
                                <span>Total</span>
                                <span className="tabular-nums">
                                    {pending.receivers.reduce((s, r) => s + parseFloat(r.amount), 0)} {symbolLabel}
                                </span>
                            </div>
                        </div>
                    )}

                    <DialogFooter>
                        <DialogClose asChild>
                            <Button variant="outline">Cancel</Button>
                        </DialogClose>
                        <Button variant="default" onClick={executeTransfers}>
                            Confirm {pending?.receivers.length ?? 0} Transfer{(pending?.receivers.length ?? 0) !== 1 ? 's' : ''}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* Progress dialog */}
            <Dialog open={showProgress} onOpenChange={(open) => { if (!open && transfersDone) resetAfterTransfer() }}>
                <DialogContent className="max-w-md">
                    <DialogHeader>
                        <DialogTitle>{transfersDone ? 'Transfers Complete' : 'Transferring…'}</DialogTitle>
                        <DialogDescription>
                            From:{' '}
                            {activeTransfer?.senderLabel ? `${activeTransfer.senderLabel} · ` : ''}
                            {activeTransfer ? maskPubKey(activeTransfer.senderPublicKey) : ''}
                        </DialogDescription>
                    </DialogHeader>

                    <div className="flex flex-col divide-y">
                        {activeTransfer?.receivers.map((r) => {
                            const status = receiverStatuses[r.walletId] ?? 'pending'
                            return (
                                <div key={r.walletId} className="flex items-center gap-3 py-3">
                                    {/* Status icon */}
                                    <div className="size-5 shrink-0 flex items-center justify-center">
                                        {status === 'pending' && (
                                            <span className="size-2 rounded-full bg-muted-foreground/30" />
                                        )}
                                        {status === 'loading' && (
                                            <span className="size-4 animate-spin rounded-full border-2 border-blue-500 border-t-transparent" />
                                        )}
                                        {status === 'success' && (
                                            <svg className="size-4 text-green-500" viewBox="0 0 20 20" fill="currentColor">
                                                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                                            </svg>
                                        )}
                                        {status === 'error' && (
                                            <svg className="size-4 text-destructive" viewBox="0 0 20 20" fill="currentColor">
                                                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
                                            </svg>
                                        )}
                                    </div>

                                    <div className="flex-1 min-w-0">
                                        <p className="text-xs font-mono truncate text-foreground">
                                            {r.label ? `${r.label} · ` : ''}{maskPubKey(r.publicKey)}
                                        </p>
                                        {status === 'error' && (
                                            <p className="text-[10px] text-destructive mt-0.5">Transfer failed</p>
                                        )}
                                    </div>

                                    <span className="text-xs font-semibold tabular-nums shrink-0">{r.amount} {symbolLabel}</span>
                                </div>
                            )
                        })}
                    </div>

                    {transfersDone && (() => {
                        const total   = activeTransfer?.receivers.length ?? 0
                        const success = Object.values(receiverStatuses).filter((s) => s === 'success').length
                        const failed  = total - success
                        return (
                            <>
                                <div className={[
                                    'rounded-md px-4 py-3 text-sm',
                                    failed === 0
                                        ? 'bg-green-500/10 text-green-700 dark:text-green-400'
                                        : 'bg-destructive/10 text-destructive',
                                ].join(' ')}>
                                    {failed === 0
                                        ? `All ${success} transfer${success !== 1 ? 's' : ''} submitted successfully.`
                                        : `${success} succeeded, ${failed} failed. Check wallet balances and retry.`}
                                </div>
                                <DialogFooter>
                                    <Button variant="default" onClick={resetAfterTransfer}>Done</Button>
                                </DialogFooter>
                            </>
                        )
                    })()}
                </DialogContent>
            </Dialog>
        </>
    )
}
