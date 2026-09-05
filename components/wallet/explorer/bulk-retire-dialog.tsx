'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
    Select,
    SelectContent,
    SelectItem,
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
import type { WalletRecord } from '@/lib/types/wallet'

function maskPubKey(key: string) {
    return `${key.slice(0, 7)}....${key.slice(-7)}`
}

type RowStatus = 'pending' | 'running' | 'success' | 'error' | 'skipped'

interface Row {
    walletId: string
    label:    string
    status:   RowStatus
    error?:   string
}

type Phase = 'idle' | 'confirming' | 'running' | 'done'

export default function BulkRetireDialog({
    walletIds,
    wallets,
    onRetired,
}: {
    walletIds: string[]
    wallets:   WalletRecord[]
    onRetired: () => void
}) {
    const [phase, setPhase]           = useState<Phase>('idle')
    const [destination, setDestination] = useState('')
    const [feePayerId, setFeePayerId]   = useState('')
    const [validationError, setValidationError] = useState('')
    const [rows, setRows]             = useState<Row[]>([])

    // A fee payer must be able to sign for itself — exclude wallets already
    // in this batch (they're being retired, not paying anyone's fees) and
    // any already-inactive wallet (get_wallet_secret_by_id refuses it).
    const feePayerOptions = wallets.filter((w) => w.is_active && !walletIds.includes(w.id))

    function open() {
        setPhase('confirming')
        setDestination('')
        setFeePayerId('')
        setValidationError('')
        setRows([])
    }

    function close() {
        if (phase === 'running') return
        setPhase('idle')
    }

    async function run() {
        if (!destination.trim()) {
            setValidationError('Enter a destination address for the swept SOL.')
            return
        }

        // Already-retired wallets would just fail with a clear "inactive"
        // error from the API — skip them client-side instead so the result
        // list reads as "nothing to do here" rather than a false failure.
        const active = walletIds.filter((id) => wallets.find((w) => w.id === id)?.is_active !== false)
        const skipped = walletIds.filter((id) => !active.includes(id))

        const initialRows: Row[] = [
            ...skipped.map((id): Row => ({
                walletId: id,
                label:    wallets.find((w) => w.id === id)?.label ?? maskPubKey(wallets.find((w) => w.id === id)?.public_key ?? id),
                status:   'skipped',
            })),
            ...active.map((id): Row => ({
                walletId: id,
                label:    wallets.find((w) => w.id === id)?.label ?? maskPubKey(wallets.find((w) => w.id === id)?.public_key ?? id),
                status:   'pending',
            })),
        ]
        setRows(initialRows)
        setPhase('running')
        setValidationError('')

        if (active.length === 0) {
            setPhase('done')
            return
        }

        function applyLine(line: string) {
            if (!line.trim()) return
            try {
                const parsed = JSON.parse(line) as { walletId: string; status: RowStatus; error?: string }
                setRows((prev) => prev.map((r) => (r.walletId === parsed.walletId ? { ...r, status: parsed.status, error: parsed.error } : r)))
            } catch {
                // A malformed/truncated line shouldn't abort reading the rest of the stream.
            }
        }

        try {
            const res = await fetch('/api/wallets/retire-batch', {
                method:  'POST',
                headers: { 'Content-Type': 'application/json' },
                body:    JSON.stringify({
                    walletIds:          active,
                    destinationAddress: destination.trim(),
                    feePayerWalletId:   feePayerId || undefined,
                }),
            })

            if (!res.ok || !res.body) {
                const data = await res.json().catch(() => ({}))
                setRows((prev) => prev.map((r) => (active.includes(r.walletId) ? { ...r, status: 'error', error: data.error ?? `HTTP ${res.status}` } : r)))
            } else {
                // Streamed newline-delimited JSON — a 'running' line as each
                // wallet starts, then its final success/error line — so this
                // updates row-by-row as the batch progresses server-side,
                // rather than sitting blank until every wallet is done
                // (which, across many wallets, can take minutes and looks
                // indistinguishable from having silently died).
                const reader = res.body.getReader()
                const decoder = new TextDecoder()
                let buffer = ''
                while (true) {
                    const { done, value } = await reader.read()
                    if (done) break
                    buffer += decoder.decode(value, { stream: true })
                    const lines = buffer.split('\n')
                    buffer = lines.pop() ?? ''
                    lines.forEach(applyLine)
                }
                if (buffer.trim()) applyLine(buffer)
            }
        } catch (err) {
            const message = err instanceof Error ? err.message : 'Network error'
            setRows((prev) => prev.map((r) => (r.status === 'pending' || r.status === 'running') ? { ...r, status: 'error', error: message } : r))
        }

        // Defensive: a truncated/dropped stream (crashed dev server, network
        // drop mid-batch) must never leave a row stuck spinning forever with
        // no explanation — anything that never got a final line is reported
        // as such, not silently left as "running".
        setRows((prev) => prev.map((r) => (r.status === 'pending' || r.status === 'running')
            ? { ...r, status: 'error', error: 'No result received — check server logs' }
            : r))

        setPhase('done')
        onRetired()
    }

    const successCount = rows.filter((r) => r.status === 'success').length
    const errorCount   = rows.filter((r) => r.status === 'error').length

    return (
        <>
            <Button size="sm" variant="destructive" onClick={open} disabled={walletIds.length === 0}>
                Retire Selected ({walletIds.length})
            </Button>

            <Dialog open={phase !== 'idle'} onOpenChange={(o) => { if (!o) close() }}>
                <DialogContent className="max-w-md">
                    <DialogHeader>
                        <DialogTitle>
                            {phase === 'done' ? 'Bulk Retire Complete' : `Retire ${walletIds.length} Wallet${walletIds.length !== 1 ? 's' : ''}`}
                        </DialogTitle>
                        <DialogDescription>
                            {phase === 'done'
                                ? 'Each wallet below either retired successfully or shows why it didn’t.'
                                : 'Verifies each wallet holds no tokens, closes any leftover empty token accounts, sweeps all remaining SOL to the address below, then permanently marks it unusable. This cannot be undone.'}
                        </DialogDescription>
                    </DialogHeader>

                    {(phase === 'confirming' || (phase === 'running' && rows.length === 0)) && (
                        <div className="flex flex-col gap-3">
                            <div className="flex flex-col gap-1.5">
                                <label className="text-xs font-medium text-muted-foreground">Send remaining SOL to</label>
                                <Input
                                    placeholder="Destination Solana address"
                                    value={destination}
                                    onChange={(e) => setDestination(e.target.value)}
                                    disabled={phase === 'running'}
                                    className="font-mono text-xs"
                                />
                            </div>
                            <div className="flex flex-col gap-1.5">
                                <label className="text-xs font-medium text-muted-foreground">
                                    Fee payer wallet (optional — covers fees for any wallet in this batch too low on SOL to close its own leftover token accounts)
                                </label>
                                <Select value={feePayerId} onValueChange={setFeePayerId} disabled={phase === 'running'}>
                                    <SelectTrigger>
                                        <SelectValue placeholder="None — each wallet pays its own fees" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {feePayerOptions.map((w) => (
                                            <SelectItem key={w.id} value={w.id}>
                                                {w.label ? `${w.label} · ` : ''}{maskPubKey(w.public_key)}
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>
                            {validationError && <p className="text-xs text-destructive">{validationError}</p>}
                        </div>
                    )}

                    {rows.length > 0 && (
                        <div className="flex max-h-80 flex-col divide-y divide-border overflow-y-auto rounded-lg border border-border">
                            {rows.map((r) => (
                                <div key={r.walletId} className="flex items-center gap-3 px-3 py-2.5 text-xs">
                                    <div className="size-4 shrink-0 flex items-center justify-center">
                                        {r.status === 'pending' && <span className="size-2 rounded-full bg-muted-foreground/30" />}
                                        {r.status === 'running' && <span className="size-3.5 animate-spin rounded-full border-2 border-destructive border-t-transparent" />}
                                        {r.status === 'success' && (
                                            <svg className="size-3.5 text-green-500" viewBox="0 0 20 20" fill="currentColor">
                                                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                                            </svg>
                                        )}
                                        {r.status === 'error' && (
                                            <svg className="size-3.5 text-destructive" viewBox="0 0 20 20" fill="currentColor">
                                                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
                                            </svg>
                                        )}
                                        {r.status === 'skipped' && <span className="size-2 rounded-full bg-muted-foreground/50" />}
                                    </div>
                                    <span className="flex-1 truncate font-mono">{r.label}</span>
                                    {r.status === 'skipped' && <span className="shrink-0 text-muted-foreground">already retired</span>}
                                    {r.status === 'error' && r.error && (
                                        <span className="shrink-0 max-w-40 truncate text-destructive" title={r.error}>{r.error}</span>
                                    )}
                                </div>
                            ))}
                        </div>
                    )}

                    {phase === 'done' && (
                        <div className={[
                            'rounded-md px-4 py-3 text-sm',
                            errorCount === 0 ? 'bg-green-500/10 text-green-700 dark:text-green-400' : 'bg-destructive/10 text-destructive',
                        ].join(' ')}>
                            {errorCount === 0
                                ? `All ${successCount} wallet${successCount !== 1 ? 's' : ''} retired successfully.`
                                : `${successCount} retired, ${errorCount} failed — see above.`}
                        </div>
                    )}

                    <DialogFooter>
                        {phase === 'done' ? (
                            <Button onClick={close}>Done</Button>
                        ) : (
                            <>
                                <DialogClose asChild>
                                    <Button variant="outline" disabled={phase === 'running'}>Cancel</Button>
                                </DialogClose>
                                <Button variant="destructive" onClick={run} disabled={phase === 'running'}>
                                    {phase === 'running' ? 'Retiring…' : `Confirm Retire (${walletIds.length})`}
                                </Button>
                            </>
                        )}
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </>
    )
}
