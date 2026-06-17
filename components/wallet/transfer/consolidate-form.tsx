'use client'

import { useState, useEffect, useMemo, Fragment } from 'react'
import type { WalletRecord } from '@/lib/types/wallet'
import { lamportsStringToBN, lamportsBNToSolDisplay } from '@/lib/lamports'
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

// Mirrors consolidateSOL's txFeeBufferLamports
const FEE_BUFFER_LAMPORTS = 10_000

type WalletTypeRow = { id: string; name: string }

type WalletGroup = {
    id:      string
    name:    string
    color:   string | null
    wallets: WalletRecord[]
}

type TransferStatus = 'pending' | 'loading' | 'success' | 'error'

type PendingConsolidate = {
    receiverPublicKey: string
    receiverLabel:     string | null
    senders: { walletId: string; publicKey: string; label: string | null; estimatedSOL: number }[]
}

function maskPubKey(key: string) {
    return `${key.slice(0, 7)}....${key.slice(-7)}`
}

function sweepLamports(wallet: WalletRecord): number {
    return Math.max(0, (wallet.solana_balance_in_lamports?.toNumber() ?? 0) - FEE_BUFFER_LAMPORTS)
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

export default function ConsolidateForm() {
    const [wallets,      setWallets]      = useState<WalletRecord[]>([])
    const [walletTypes,  setWalletTypes]  = useState<WalletTypeRow[]>([])
    const [loading,      setLoading]      = useState(true)
    const [activeFilters, setActiveFilters] = useState<string[]>([])
    const [receiverWalletId, setReceiverWalletId] = useState('')
    const [selectedSenders,  setSelectedSenders]  = useState<Set<string>>(new Set())
    const [pending,      setPending]      = useState<PendingConsolidate | null>(null)
    const [activeTransfer, setActiveTransfer] = useState<PendingConsolidate | null>(null)
    const [showProgress, setShowProgress] = useState(false)
    const [senderStatuses, setSenderStatuses] = useState<Record<string, TransferStatus>>({})
    const [transfersDone,  setTransfersDone]  = useState(false)
    const [validationError, setValidationError] = useState('')
    const [copiedId,     setCopiedId]     = useState<string | null>(null)

    useEffect(() => {
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
                setWalletTypes(data.walletTypes ?? [])
            })
            .catch(() => {})
            .finally(() => setLoading(false))
    }, [])

    // Drop receiver from sender selection if accidentally selected first
    useEffect(() => {
        if (receiverWalletId && selectedSenders.has(receiverWalletId)) {
            setSelectedSenders(prev => { const n = new Set(prev); n.delete(receiverWalletId); return n })
        }
    }, [receiverWalletId, selectedSenders])

    const receiverGroups = useMemo<[string, WalletRecord[]][]>(() => {
        const map: Record<string, WalletRecord[]> = {}
        for (const w of wallets) {
            const key = w.wallet_type ?? 'Other'
            ;(map[key] ??= []).push(w)
        }
        return Object.entries(map)
    }, [wallets])

    const visibleWallets = useMemo(() => {
        const without = wallets.filter(w => w.id !== receiverWalletId)
        if (activeFilters.length === 0) return without
        return without.filter(w => w.wallet_type_id != null && activeFilters.includes(w.wallet_type_id))
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

    const ungrouped      = useMemo(() => visibleWallets.filter(w => !w.wallet_group_id), [visibleWallets])
    const allVisibleIds  = useMemo(() => visibleWallets.map(w => w.id), [visibleWallets])

    const totalEstimatedSOL = useMemo(() =>
        [...selectedSenders].reduce((sum, id) => {
            const w = wallets.find(w => w.id === id)
            return sum + (w ? sweepLamports(w) / 1_000_000_000 : 0)
        }, 0),
    [selectedSenders, wallets])

    function toggleFilter(typeId: string) {
        setActiveFilters(prev => prev.includes(typeId) ? prev.filter(id => id !== typeId) : [...prev, typeId])
    }

    function toggleWallet(id: string) {
        setSelectedSenders(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n })
    }

    function toggleGroup(groupWallets: WalletRecord[]) {
        const allSelected = groupWallets.every(w => selectedSenders.has(w.id))
        setSelectedSenders(prev => {
            const n = new Set(prev)
            allSelected ? groupWallets.forEach(w => n.delete(w.id)) : groupWallets.forEach(w => n.add(w.id))
            return n
        })
    }

    function selectAll() {
        setSelectedSenders(prev => { const n = new Set(prev); allVisibleIds.forEach(id => n.add(id)); return n })
    }

    function clearAll() {
        setSelectedSenders(prev => { const n = new Set(prev); allVisibleIds.forEach(id => n.delete(id)); return n })
    }

    function handleSubmit() {
        setValidationError('')
        if (!receiverWalletId)        { setValidationError('Select a receiver wallet.'); return }
        if (selectedSenders.size === 0) { setValidationError('Select at least one wallet to sweep.'); return }

        const receiver = wallets.find(w => w.id === receiverWalletId)!
        const senders  = [...selectedSenders].map(id => {
            const w = wallets.find(w => w.id === id)!
            return { walletId: id, publicKey: w.public_key, label: w.label, estimatedSOL: sweepLamports(w) / 1_000_000_000 }
        }).filter(s => s.estimatedSOL > 0)

        if (senders.length === 0) { setValidationError('None of the selected wallets have a sweepable balance.'); return }

        setPending({ receiverPublicKey: receiver.public_key, receiverLabel: receiver.label, senders })
    }

    function resetAfterTransfer() {
        setShowProgress(false)
        setReceiverWalletId('')
        setSelectedSenders(new Set())
        setActiveFilters([])
        setActiveTransfer(null)
        setSenderStatuses({})
        setTransfersDone(false)
    }

    async function executeConsolidate() {
        if (!pending) return
        const transfer = pending
        setPending(null)

        const initial: Record<string, TransferStatus> = {}
        transfer.senders.forEach(s => { initial[s.walletId] = 'loading' })
        setSenderStatuses(initial)
        setActiveTransfer(transfer)
        setTransfersDone(false)
        setShowProgress(true)

        try {
            const res = await fetch('/api/wallet/transfer/consolidate', {
                method:  'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    receiverPublicKey: transfer.receiverPublicKey,
                    senders: transfer.senders.map(s => ({ walletId: s.walletId })),
                }),
            })

            if (res.ok) {
                const { results } = await res.json()
                const updated: Record<string, TransferStatus> = {}
                for (const r of results as { walletId: string; success: boolean }[]) {
                    updated[r.walletId] = r.success ? 'success' : 'error'
                }
                setSenderStatuses(updated)
            } else {
                const failed: Record<string, TransferStatus> = {}
                transfer.senders.forEach(s => { failed[s.walletId] = 'error' })
                setSenderStatuses(failed)
            }
        } catch {
            const failed: Record<string, TransferStatus> = {}
            transfer.senders.forEach(s => { failed[s.walletId] = 'error' })
            setSenderStatuses(failed)
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
        const allSelected  = group.wallets.every(w => selectedSenders.has(w.id))
        const someSelected = !allSelected && group.wallets.some(w => selectedSenders.has(w.id))
        return (
            <tr
                key={`group-${group.id}`}
                className="border-b bg-muted/50 cursor-pointer hover:bg-muted/70 transition-colors select-none"
                onClick={() => toggleGroup(group.wallets)}
            >
                <td colSpan={4} className="px-3 py-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
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
                        allSelected   ? 'border-blue-500 bg-blue-500'
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
        const checked     = selectedSenders.has(wallet.id)
        const sweepSOL    = sweepLamports(wallet) / 1_000_000_000
        const hasSweepable = sweepLamports(wallet) > 0
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
                                        onClick={e => copyKey(e, wallet.public_key, wallet.id)}
                                        onKeyDown={e => e.key === 'Enter' && copyKey(e as never, wallet.public_key, wallet.id)}
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
                                        onClick={e => e.stopPropagation()}
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
                <td className="px-3 py-2.5 text-right tabular-nums text-xs">
                    {wallet.solana_balance_in_lamports
                        ? <span className={hasSweepable ? 'text-foreground' : 'text-muted-foreground/50'}>
                            {lamportsBNToSolDisplay(wallet.solana_balance_in_lamports)}
                          </span>
                        : <span className="text-muted-foreground">—</span>}
                </td>
                <td className="px-3 py-2.5 text-right">
                    <span
                        onClick={e => { e.stopPropagation(); toggleWallet(wallet.id) }}
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

    return (
        <>
            <div className="flex flex-col gap-6">

                {/* Receiver */}
                <div className="flex flex-col gap-1.5 max-w-sm">
                    <FieldLabel>Receiver Wallet</FieldLabel>
                    <Select value={receiverWalletId} onValueChange={setReceiverWalletId}>
                        <SelectTrigger>
                            <SelectValue placeholder="Select destination wallet" />
                        </SelectTrigger>
                        <SelectContent>
                            {receiverGroups.map(([typeName, group], i) => (
                                <SelectGroup key={typeName}>
                                    {i > 0 && <SelectSeparator />}
                                    <SelectLabel>{typeName}</SelectLabel>
                                    {group.map(w => (
                                        <SelectItem key={w.id} value={w.id}>
                                            {w.label ? `${w.label} · ` : ''}
                                            {maskPubKey(w.public_key)}
                                            {w.solana_balance_in_lamports
                                                ? ` · ${lamportsBNToSolDisplay(w.solana_balance_in_lamports)} SOL`
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
                    <FieldLabel>Wallets to Sweep</FieldLabel>

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
                        {walletTypes.map(type => (
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
                                    <th className="px-3 py-2.5 text-right">SOL Balance</th>
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
                                {walletGroups.map(group => (
                                    <Fragment key={group.id}>
                                        {renderGroupHeader(group)}
                                        {group.wallets.map(w => renderRow(w, ++rowIndex))}
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
                                        {ungrouped.map(w => renderRow(w, ++rowIndex))}
                                    </Fragment>
                                )}

                                {visibleWallets.length === 0 && (
                                    <tr>
                                        <td colSpan={5} className="px-3 py-6 text-center text-sm text-muted-foreground">
                                            {receiverWalletId ? 'No other wallets found.' : 'Select a receiver wallet to see available senders.'}
                                        </td>
                                    </tr>
                                )}
                            </tbody>
                        </table>
                    </div>

                    {selectedSenders.size > 0 && (
                        <div className="flex items-center justify-between text-xs text-muted-foreground">
                            <span>{selectedSenders.size} wallet{selectedSenders.size !== 1 ? 's' : ''} selected</span>
                            {totalEstimatedSOL > 0 && (
                                <span>Est. total: {totalEstimatedSOL.toFixed(9)} SOL</span>
                            )}
                        </div>
                    )}
                </div>

                {validationError && (
                    <p className="text-sm text-destructive">{validationError}</p>
                )}

                <Button size="lg" onClick={handleSubmit}>
                    Consolidate
                </Button>
            </div>

            {/* Confirmation dialog */}
            <Dialog open={!!pending} onOpenChange={open => { if (!open) setPending(null) }}>
                <DialogContent className="max-w-md">
                    <DialogHeader>
                        <DialogTitle>Confirm Consolidation</DialogTitle>
                        <DialogDescription>Each wallet will sweep its full balance minus fees.</DialogDescription>
                    </DialogHeader>

                    {pending && (
                        <div className="flex flex-col gap-3 text-sm">
                            <div className="flex justify-between text-muted-foreground">
                                <span>To</span>
                                <span className="font-mono text-foreground">
                                    {pending.receiverLabel ? `${pending.receiverLabel} · ` : ''}{maskPubKey(pending.receiverPublicKey)}
                                </span>
                            </div>

                            <div className="border-t pt-3 flex flex-col gap-2">
                                {pending.senders.map(s => (
                                    <div key={s.walletId} className="flex justify-between">
                                        <span className="font-mono text-muted-foreground">
                                            {s.label ? `${s.label} · ` : ''}{maskPubKey(s.publicKey)}
                                        </span>
                                        <span className="tabular-nums">~{s.estimatedSOL.toFixed(9)} SOL</span>
                                    </div>
                                ))}
                            </div>

                            <div className="border-t pt-3 flex justify-between font-semibold">
                                <span>Est. Total</span>
                                <span className="tabular-nums">
                                    ~{pending.senders.reduce((s, r) => s + r.estimatedSOL, 0).toFixed(9)} SOL
                                </span>
                            </div>
                        </div>
                    )}

                    <DialogFooter>
                        <DialogClose asChild>
                            <Button variant="outline">Cancel</Button>
                        </DialogClose>
                        <Button onClick={executeConsolidate}>
                            Confirm {pending?.senders.length ?? 0} Sweep{(pending?.senders.length ?? 0) !== 1 ? 's' : ''}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* Progress dialog */}
            <Dialog open={showProgress} onOpenChange={open => { if (!open && transfersDone) resetAfterTransfer() }}>
                <DialogContent className="max-w-md">
                    <DialogHeader>
                        <DialogTitle>{transfersDone ? 'Consolidation Complete' : 'Sweeping…'}</DialogTitle>
                        <DialogDescription>
                            To:{' '}
                            {activeTransfer?.receiverLabel ? `${activeTransfer.receiverLabel} · ` : ''}
                            {activeTransfer ? maskPubKey(activeTransfer.receiverPublicKey) : ''}
                        </DialogDescription>
                    </DialogHeader>

                    <div className="flex flex-col divide-y">
                        {activeTransfer?.senders.map(s => {
                            const status = senderStatuses[s.walletId] ?? 'pending'
                            return (
                                <div key={s.walletId} className="flex items-center gap-3 py-3">
                                    <div className="size-5 shrink-0 flex items-center justify-center">
                                        {status === 'pending' && <span className="size-2 rounded-full bg-muted-foreground/30" />}
                                        {status === 'loading' && <span className="size-4 animate-spin rounded-full border-2 border-blue-500 border-t-transparent" />}
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
                                            {s.label ? `${s.label} · ` : ''}{maskPubKey(s.publicKey)}
                                        </p>
                                        {status === 'error' && (
                                            <p className="text-[10px] text-destructive mt-0.5">Sweep failed</p>
                                        )}
                                    </div>

                                    <span className="text-xs tabular-nums shrink-0 text-muted-foreground">
                                        ~{s.estimatedSOL.toFixed(4)} SOL
                                    </span>
                                </div>
                            )
                        })}
                    </div>

                    {transfersDone && (() => {
                        const total   = activeTransfer?.senders.length ?? 0
                        const success = Object.values(senderStatuses).filter(s => s === 'success').length
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
                                        ? `All ${success} wallet${success !== 1 ? 's' : ''} swept successfully.`
                                        : `${success} succeeded, ${failed} failed. Check balances and retry.`}
                                </div>
                                <DialogFooter>
                                    <Button onClick={resetAfterTransfer}>Done</Button>
                                </DialogFooter>
                            </>
                        )
                    })()}
                </DialogContent>
            </Dialog>
        </>
    )
}
