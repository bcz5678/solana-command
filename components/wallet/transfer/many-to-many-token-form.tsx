'use client'

import { useState, useEffect, useMemo } from 'react'
import type { WalletRecord } from '@/lib/types/wallet'
import { Button } from '@/components/ui/button'
import { FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
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
import { Plus, X } from 'lucide-react'
import TokenPicker, { type TokenPickerValue } from './token-picker'

function maskPubKey(key: string) {
    return `${key.slice(0, 7)}....${key.slice(-7)}`
}

let nextRowKey = 0
function newRowKey() {
    return `row-${++nextRowKey}`
}

type ToMode = 'wallet' | 'external'

interface TransferRow {
    key:          string
    fromWalletId: string
    toMode:       ToMode
    toWalletId:   string
    toAddress:    string
    amount:       string
}

function emptyRow(): TransferRow {
    return { key: newRowKey(), fromWalletId: '', toMode: 'wallet', toWalletId: '', toAddress: '', amount: '' }
}

type EdgeStatus = 'pending' | 'loading' | 'success' | 'error'

interface PendingEdge {
    fromWalletId:   string
    fromLabel:      string
    fromPublicKey:  string
    toWalletId?:    string
    toLabel:        string | null
    toAddress:      string
    amount:         string
}

export default function ManyToManyTokenForm() {
    const [wallets, setWallets] = useState<WalletRecord[]>([])
    const [loading, setLoading] = useState(true)
    const [rows, setRows]       = useState<TransferRow[]>([emptyRow(), emptyRow()])
    const [validationError, setValidationError] = useState('')

    const [token, setToken] = useState<TokenPickerValue>({ mintAddress: '', mintValid: false, tokenSymbol: null, logoUrl: null })
    const [tokenBalances, setTokenBalances]     = useState<Record<string, number>>({})
    const [balancesLoading, setBalancesLoading] = useState(false)

    const [pending, setPending]             = useState<PendingEdge[] | null>(null)
    const [activeEdges, setActiveEdges]     = useState<PendingEdge[] | null>(null)
    const [edgeStatuses, setEdgeStatuses]   = useState<EdgeStatus[]>([])
    const [showProgress, setShowProgress]   = useState(false)
    const [transfersDone, setTransfersDone] = useState(false)

    useEffect(() => {
        fetch('/api/wallets/explorer')
            .then((r) => (r.ok ? r.json() : null))
            .then((data) => setWallets((data?.wallets ?? []) as WalletRecord[]))
            .catch(() => {})
            .finally(() => setLoading(false))
    }, [])

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
    const walletById  = useMemo(() => new Map(wallets.map((w) => [w.id, w])), [wallets])

    const walletGroups = useMemo<[string, WalletRecord[]][]>(() => {
        const map: Record<string, WalletRecord[]> = {}
        for (const w of wallets) {
            const key = w.wallet_type ?? 'Other'
            ;(map[key] ??= []).push(w)
        }
        return Object.entries(map)
    }, [wallets])

    function updateRow(key: string, patch: Partial<TransferRow>) {
        setRows((prev) => prev.map((r) => (r.key === key ? { ...r, ...patch } : r)))
    }

    function addRow() {
        setRows((prev) => [...prev, emptyRow()])
    }

    function removeRow(key: string) {
        setRows((prev) => (prev.length <= 1 ? prev : prev.filter((r) => r.key !== key)))
    }

    // Per-sender totals across all rows, for a running "over balance" hint —
    // the server enforces this too, but flagging it before submit saves a
    // round trip on the obvious case.
    const totalsByFromWallet = useMemo(() => {
        const totals: Record<string, number> = {}
        for (const r of rows) {
            const amt = parseFloat(r.amount)
            if (!r.fromWalletId || isNaN(amt) || amt <= 0) continue
            totals[r.fromWalletId] = (totals[r.fromWalletId] ?? 0) + amt
        }
        return totals
    }, [rows])

    const overBalanceWalletIds = useMemo(() => {
        if (!token.mintValid) return new Set<string>()
        return new Set(
            Object.entries(totalsByFromWallet)
                .filter(([id, total]) => tokenBalances[id] != null && total > tokenBalances[id])
                .map(([id]) => id),
        )
    }, [totalsByFromWallet, tokenBalances, token.mintValid])

    function handleSubmit() {
        setValidationError('')
        if (!token.mintValid) { setValidationError('Select a valid token.'); return }
        if (rows.length === 0) { setValidationError('Add at least one transfer.'); return }

        const resolved: PendingEdge[] = []
        for (const r of rows) {
            if (!r.fromWalletId) { setValidationError('Every row needs a source wallet.'); return }
            const fromWallet = walletById.get(r.fromWalletId)
            if (!fromWallet) { setValidationError('Every row needs a source wallet.'); return }

            const toAddress = r.toMode === 'wallet' ? (walletById.get(r.toWalletId)?.public_key ?? '') : r.toAddress.trim()
            if (!toAddress || toAddress.length < 32) { setValidationError('Every row needs a valid destination.'); return }

            const amt = parseFloat(r.amount)
            if (!r.amount || isNaN(amt) || amt <= 0) { setValidationError('Every row needs an amount greater than 0.'); return }

            const toWallet = r.toMode === 'wallet' ? walletById.get(r.toWalletId) : wallets.find((w) => w.public_key === toAddress)
            resolved.push({
                fromWalletId:  r.fromWalletId,
                fromLabel:     fromWallet.label ?? maskPubKey(fromWallet.public_key),
                fromPublicKey: fromWallet.public_key,
                toWalletId:    toWallet?.id,
                toLabel:       toWallet?.label ?? null,
                toAddress,
                amount:        r.amount,
            })
        }

        if (overBalanceWalletIds.size > 0) {
            setValidationError('One or more source wallets don’t hold enough for everything selected from them.')
            return
        }

        setPending(resolved)
    }

    function resetAfterTransfer() {
        setShowProgress(false)
        setRows([emptyRow(), emptyRow()])
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

    if (loading) return <p className="text-sm text-muted-foreground py-4">Loading wallets…</p>

    return (
        <>
            <div className="flex flex-col gap-6">

                {/* Token */}
                <div className="max-w-sm">
                    <TokenPicker onChange={setToken} />
                </div>

                {/* Rows */}
                <div className="flex flex-col gap-3">
                    <FieldLabel>Transfers</FieldLabel>

                    <div className="flex flex-col gap-2">
                        {rows.map((row, i) => {
                            const fromBalance = tokenBalances[row.fromWalletId]
                            const isOver = overBalanceWalletIds.has(row.fromWalletId)
                            return (
                                <div key={row.key} className="flex flex-wrap items-start gap-2 rounded-md border border-border p-2.5">
                                    <span className="mt-2.5 w-5 shrink-0 text-right text-xs text-muted-foreground tabular-nums">{i + 1}</span>

                                    {/* From */}
                                    <div className="flex min-w-55 flex-1 flex-col gap-1">
                                        <Select value={row.fromWalletId} onValueChange={(v) => updateRow(row.key, { fromWalletId: v })}>
                                            <SelectTrigger className={isOver ? 'border-destructive' : ''}>
                                                <SelectValue placeholder="From wallet" />
                                            </SelectTrigger>
                                            <SelectContent>
                                                {walletGroups.map(([typeName, group], gi) => (
                                                    <SelectGroup key={typeName}>
                                                        {gi > 0 && <SelectSeparator />}
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
                                        {row.fromWalletId && (
                                            <p className={`text-[10px] ${isOver ? 'text-destructive' : 'text-muted-foreground'}`}>
                                                {balancesLoading
                                                    ? 'Checking balance…'
                                                    : fromBalance != null
                                                        ? `Balance ${fromBalance} ${symbolLabel}${isOver ? ' — over-committed across rows' : ''}`
                                                        : null}
                                            </p>
                                        )}
                                    </div>

                                    <span className="mt-2.5 shrink-0 text-xs text-muted-foreground">→</span>

                                    {/* To */}
                                    <div className="flex min-w-55 flex-1 flex-col gap-1">
                                        <div className="flex items-center gap-1.5">
                                            <button
                                                type="button"
                                                onClick={() => updateRow(row.key, { toMode: 'wallet' })}
                                                className={[
                                                    'px-2 py-0.5 rounded text-[10px] font-medium border transition-colors',
                                                    row.toMode === 'wallet'
                                                        ? 'bg-blue-500 border-blue-500 text-white'
                                                        : 'border-border text-muted-foreground hover:border-blue-400',
                                                ].join(' ')}
                                            >
                                                Our wallet
                                            </button>
                                            <button
                                                type="button"
                                                onClick={() => updateRow(row.key, { toMode: 'external' })}
                                                className={[
                                                    'px-2 py-0.5 rounded text-[10px] font-medium border transition-colors',
                                                    row.toMode === 'external'
                                                        ? 'bg-blue-500 border-blue-500 text-white'
                                                        : 'border-border text-muted-foreground hover:border-blue-400',
                                                ].join(' ')}
                                            >
                                                External address
                                            </button>
                                        </div>
                                        {row.toMode === 'wallet' ? (
                                            <Select value={row.toWalletId} onValueChange={(v) => updateRow(row.key, { toWalletId: v })}>
                                                <SelectTrigger>
                                                    <SelectValue placeholder="To wallet" />
                                                </SelectTrigger>
                                                <SelectContent>
                                                    {walletGroups.map(([typeName, group], gi) => (
                                                        <SelectGroup key={typeName}>
                                                            {gi > 0 && <SelectSeparator />}
                                                            <SelectLabel>{typeName}</SelectLabel>
                                                            {group.map((w) => (
                                                                <SelectItem key={w.id} value={w.id}>
                                                                    {w.label ? `${w.label} · ` : ''}
                                                                    {maskPubKey(w.public_key)}
                                                                </SelectItem>
                                                            ))}
                                                        </SelectGroup>
                                                    ))}
                                                </SelectContent>
                                            </Select>
                                        ) : (
                                            <Input
                                                placeholder="Enter Solana public key"
                                                value={row.toAddress}
                                                onChange={(e) => updateRow(row.key, { toAddress: e.target.value })}
                                                className="font-mono text-xs"
                                            />
                                        )}
                                    </div>

                                    {/* Amount */}
                                    <div className="flex w-32 shrink-0 flex-col gap-1">
                                        <Input
                                            type="number"
                                            min={0}
                                            step="any"
                                            placeholder="0.00"
                                            value={row.amount}
                                            onChange={(e) => updateRow(row.key, { amount: e.target.value })}
                                            className="text-right tabular-nums"
                                        />
                                    </div>

                                    <button
                                        type="button"
                                        onClick={() => removeRow(row.key)}
                                        disabled={rows.length <= 1}
                                        className="mt-1.5 shrink-0 rounded p-1 text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                                        aria-label="Remove transfer"
                                    >
                                        <X className="size-3.5" />
                                    </button>
                                </div>
                            )
                        })}
                    </div>

                    <Button variant="outline" size="sm" onClick={addRow} className="w-fit gap-1.5">
                        <Plus className="size-3.5" />
                        Add Transfer
                    </Button>
                </div>

                {/* Validation error */}
                {validationError && (
                    <p className="text-sm text-destructive">{validationError}</p>
                )}

                {/* Submit */}
                <Button size="lg" variant="default" onClick={handleSubmit} className="w-fit">
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
                        <div className="flex max-h-80 flex-col gap-2 overflow-y-auto text-sm">
                            {pending.map((e, i) => (
                                <div key={i} className="flex items-center justify-between gap-2 border-b pb-2 last:border-b-0">
                                    <span className="min-w-0 truncate font-mono text-xs text-muted-foreground">
                                        {e.fromLabel} → {e.toLabel ?? maskPubKey(e.toAddress)}
                                    </span>
                                    <span className="shrink-0 font-semibold tabular-nums">{e.amount} {symbolLabel}</span>
                                </div>
                            ))}
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
            <Dialog open={showProgress} onOpenChange={(open) => { if (!open && transfersDone) resetAfterTransfer() }}>
                <DialogContent className="max-w-md">
                    <DialogHeader>
                        <DialogTitle>{transfersDone ? 'Transfers Complete' : 'Transferring…'}</DialogTitle>
                        <DialogDescription>{activeEdges?.length ?? 0} transfer{(activeEdges?.length ?? 0) !== 1 ? 's' : ''}</DialogDescription>
                    </DialogHeader>

                    <div className="flex max-h-80 flex-col divide-y overflow-y-auto">
                        {activeEdges?.map((e, i) => {
                            const status = edgeStatuses[i] ?? 'pending'
                            return (
                                <div key={i} className="flex items-center gap-3 py-3">
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
                                            {e.fromLabel} → {e.toLabel ?? maskPubKey(e.toAddress)}
                                        </p>
                                        {status === 'error' && <p className="text-[10px] text-destructive mt-0.5">Transfer failed</p>}
                                    </div>
                                    <span className="text-xs font-semibold tabular-nums shrink-0">{e.amount} {symbolLabel}</span>
                                </div>
                            )
                        })}
                    </div>

                    {transfersDone && (() => {
                        const total   = activeEdges?.length ?? 0
                        const success = edgeStatuses.filter((s) => s === 'success').length
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
