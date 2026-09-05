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

type Status = 'idle' | 'confirming' | 'running' | 'success' | 'error'

interface RetireResult {
    closedAccounts: number
    sweptLamports:  string
}

export default function RetireWalletDialog({
    wallet,
    wallets,
    onRetired,
}: {
    wallet:    WalletRecord
    wallets:   WalletRecord[]
    onRetired: () => void
}) {
    const [status, setStatus]     = useState<Status>('idle')
    const [destination, setDestination] = useState('')
    const [feePayerId, setFeePayerId]   = useState('')
    const [error, setError]       = useState('')
    const [result, setResult]     = useState<RetireResult | null>(null)

    // A fee payer must be able to sign — an already-retired wallet can't
    // (get_wallet_secret_by_id refuses it), and it obviously can't pay fees
    // for its own retirement either.
    const feePayerOptions = wallets.filter((w) => w.is_active && w.id !== wallet.id)

    function open() {
        setStatus('confirming')
        setDestination('')
        setFeePayerId('')
        setError('')
        setResult(null)
    }

    function close() {
        if (status === 'running') return
        setStatus('idle')
    }

    async function runRetire() {
        if (!destination.trim()) {
            setError('Enter a destination address for the swept SOL.')
            return
        }
        setStatus('running')
        setError('')
        try {
            const res = await fetch('/api/wallets/retire', {
                method:  'POST',
                headers: { 'Content-Type': 'application/json' },
                body:    JSON.stringify({
                    walletId:          wallet.id,
                    destinationAddress: destination.trim(),
                    feePayerWalletId:   feePayerId || undefined,
                }),
            })
            const data = await res.json()
            if (!res.ok || !data.success) {
                setError(data.error ?? 'Retire failed')
                setStatus('error')
                return
            }
            setResult({ closedAccounts: data.closedAccounts ?? 0, sweptLamports: data.sweptLamports ?? '0' })
            setStatus('success')
            onRetired()
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Network error')
            setStatus('error')
        }
    }

    if (!wallet.is_active) {
        return <span className="text-xs text-muted-foreground">Retired</span>
    }

    return (
        <>
            <Button size="sm" variant="destructive" className="h-7 px-2 text-xs" onClick={open}>
                Retire
            </Button>

            <Dialog open={status !== 'idle'} onOpenChange={(o) => { if (!o) close() }}>
                <DialogContent className="max-w-md">
                    <DialogHeader>
                        <DialogTitle>
                            {status === 'success' ? 'Wallet Retired' : 'Retire Wallet'}
                        </DialogTitle>
                        <DialogDescription>
                            {status === 'success'
                                ? 'This wallet is now permanently unusable — no route can sign with it again.'
                                : 'Verifies the wallet holds no tokens, closes any leftover empty token accounts to reclaim their rent, sweeps all remaining SOL to the address below, then permanently marks it unusable. This cannot be undone.'}
                        </DialogDescription>
                    </DialogHeader>

                    {(status === 'confirming' || status === 'running' || status === 'error') && (
                        <div className="flex flex-col gap-3">
                            <div className="flex flex-col gap-1.5">
                                <label className="text-xs font-medium text-muted-foreground">Send remaining SOL to</label>
                                <Input
                                    placeholder="Destination Solana address"
                                    value={destination}
                                    onChange={(e) => setDestination(e.target.value)}
                                    disabled={status === 'running'}
                                    className="font-mono text-xs"
                                />
                            </div>
                            <div className="flex flex-col gap-1.5">
                                <label className="text-xs font-medium text-muted-foreground">
                                    Fee payer wallet (optional — only needed if this wallet has too little SOL to close its own leftover token accounts)
                                </label>
                                <Select value={feePayerId} onValueChange={setFeePayerId} disabled={status === 'running'}>
                                    <SelectTrigger>
                                        <SelectValue placeholder="None — this wallet pays its own fees" />
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
                            {error && <p className="text-xs text-destructive">{error}</p>}
                        </div>
                    )}

                    {status === 'success' && result && (
                        <div className="rounded-lg border border-border bg-muted/20 px-4 py-3 text-xs flex flex-col gap-1">
                            <span>Closed {result.closedAccounts} leftover token account{result.closedAccounts !== 1 ? 's' : ''}</span>
                            <span>Swept {(Number(result.sweptLamports) / 1_000_000_000).toFixed(9)} SOL</span>
                        </div>
                    )}

                    <DialogFooter>
                        {status === 'success' ? (
                            <Button onClick={close}>Done</Button>
                        ) : (
                            <>
                                <DialogClose asChild>
                                    <Button variant="outline" disabled={status === 'running'}>Cancel</Button>
                                </DialogClose>
                                <Button variant="destructive" onClick={runRetire} disabled={status === 'running'}>
                                    {status === 'running' ? 'Retiring…' : 'Confirm Retire'}
                                </Button>
                            </>
                        )}
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </>
    )
}
