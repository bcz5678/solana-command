'use client'

import { useState, useEffect, useMemo } from 'react'
import type { WalletRecord } from '@/lib/types/wallet'
import { lamportsStringToBN, lamportsBNToSolDisplay } from '@/lib/lamports'

// Base fee (5 000) + priority fee headroom — mirrors consolidateSOL's txFeeBufferLamports
const FEE_BUFFER_LAMPORTS = 10_000
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
import { ExternalLink } from 'lucide-react'

function maskPubKey(key: string) {
    return `${key.slice(0, 7)}....${key.slice(-7)}`
}

type Status = 'idle' | 'loading' | 'success' | 'error'

export default function SingleTransferForm() {
    const [wallets,      setWallets]      = useState<WalletRecord[]>([])
    const [loading,      setLoading]      = useState(true)
    const [senderWalletId, setSenderWalletId] = useState('')
    const [receiverAddress, setReceiverAddress] = useState('')
    const [amountSOL,    setAmountSOL]    = useState('')
    const [validationError, setValidationError] = useState('')

    // confirmation dialog
    const [confirmOpen,  setConfirmOpen]  = useState(false)

    // result dialog
    const [status,       setStatus]       = useState<Status>('idle')
    const [txSignature,  setTxSignature]  = useState('')
    const [errorMsg,     setErrorMsg]     = useState('')

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
            })
            .catch(() => {})
            .finally(() => setLoading(false))
    }, [])

    const senderGroups = useMemo<[string, WalletRecord[]][]>(() => {
        const map: Record<string, WalletRecord[]> = {}
        for (const w of wallets) {
            const key = w.wallet_type ?? 'Other'
            ;(map[key] ??= []).push(w)
        }
        return Object.entries(map)
    }, [wallets])

    const sender = wallets.find(w => w.id === senderWalletId)

    function handleSendMax() {
        const balance = sender?.solana_balance_in_lamports
        if (!balance || balance.lten(FEE_BUFFER_LAMPORTS)) return
        const maxLamports = balance.subn(FEE_BUFFER_LAMPORTS)
        setAmountSOL((maxLamports.toNumber() / 1_000_000_000).toFixed(9))
    }

    function handleSubmit() {
        setValidationError('')
        if (!senderWalletId)      { setValidationError('Select a sender wallet.'); return }
        if (!receiverAddress.trim()) { setValidationError('Enter a receiver address.'); return }
        if (receiverAddress.trim().length < 32) { setValidationError('Receiver address looks invalid.'); return }
        const amt = parseFloat(amountSOL)
        if (!amountSOL || isNaN(amt) || amt <= 0) { setValidationError('Enter an amount greater than 0.'); return }
        setConfirmOpen(true)
    }

    async function executeTransfer() {
        setConfirmOpen(false)
        setStatus('loading')
        setTxSignature('')
        setErrorMsg('')

        const params = new URLSearchParams({
            senderWalletId,
            receiverWalletAddress: receiverAddress.trim(),
            amountSOL: parseFloat(amountSOL).toString(),
        })

        try {
            const res  = await fetch(`/api/wallet/transfer/single?${params}`)
            const data = await res.json()
            if (!res.ok) throw new Error(data.error ?? 'Transfer failed')
            setTxSignature(data.signature ?? '')
            setStatus('success')
        } catch (err) {
            setErrorMsg(err instanceof Error ? err.message : 'Transfer failed')
            setStatus('error')
        }
    }

    function reset() {
        setStatus('idle')
        setSenderWalletId('')
        setReceiverAddress('')
        setAmountSOL('')
        setValidationError('')
        setTxSignature('')
        setErrorMsg('')
    }

    if (loading) return <p className="text-sm text-muted-foreground py-4">Loading wallets…</p>

    return (
        <>
            <div className="flex flex-col gap-6 max-w-md">

                {/* Sender */}
                <div className="flex flex-col gap-1.5">
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

                {/* Receiver */}
                <div className="flex flex-col gap-1.5">
                    <FieldLabel>Receiver Address</FieldLabel>
                    <Input
                        placeholder="Enter Solana public key"
                        value={receiverAddress}
                        onChange={e => setReceiverAddress(e.target.value)}
                        className="font-mono text-xs"
                    />
                </div>

                {/* Amount */}
                <div className="flex flex-col gap-1.5">
                    <div className="flex items-center justify-between">
                        <FieldLabel>Amount (SOL)</FieldLabel>
                        <button
                            type="button"
                            onClick={handleSendMax}
                            disabled={!sender?.solana_balance_in_lamports || sender.solana_balance_in_lamports.lten(FEE_BUFFER_LAMPORTS)}
                            className="text-[10px] border border-border rounded px-1.5 py-0.5 text-muted-foreground hover:text-blue-500 hover:border-blue-500 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                        >
                            Send Max
                        </button>
                    </div>
                    <Input
                        type="number"
                        min={0}
                        step={0.000000001}
                        placeholder="0.00"
                        value={amountSOL}
                        onChange={e => setAmountSOL(e.target.value)}
                        className="text-right tabular-nums"
                    />
                </div>

                {validationError && (
                    <p className="text-sm text-destructive">{validationError}</p>
                )}

                <Button size="lg" onClick={handleSubmit}>
                    Transfer
                </Button>
            </div>

            {/* Confirmation dialog */}
            <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
                <DialogContent className="max-w-md">
                    <DialogHeader>
                        <DialogTitle>Confirm Transfer</DialogTitle>
                        <DialogDescription>Review the details before sending.</DialogDescription>
                    </DialogHeader>

                    <div className="flex flex-col gap-3 text-sm">
                        <div className="flex justify-between text-muted-foreground">
                            <span>From</span>
                            <span className="font-mono text-foreground text-right">
                                {sender?.label ? `${sender.label} · ` : ''}{sender ? maskPubKey(sender.public_key) : ''}
                            </span>
                        </div>
                        <div className="flex justify-between text-muted-foreground">
                            <span>To</span>
                            <span className="font-mono text-foreground text-right break-all">
                                {maskPubKey(receiverAddress.trim())}
                            </span>
                        </div>
                        <div className="border-t pt-3 flex justify-between font-semibold">
                            <span>Amount</span>
                            <span className="tabular-nums">{parseFloat(amountSOL || '0').toFixed(9)} SOL</span>
                        </div>
                    </div>

                    <DialogFooter>
                        <DialogClose asChild>
                            <Button variant="outline">Cancel</Button>
                        </DialogClose>
                        <Button onClick={executeTransfer}>Confirm Transfer</Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* Result dialog */}
            <Dialog open={status !== 'idle'} onOpenChange={open => { if (!open && status !== 'loading') reset() }}>
                <DialogContent className="max-w-md">
                    <DialogHeader>
                        <DialogTitle>
                            {status === 'loading' ? 'Sending…' : status === 'success' ? 'Transfer Sent' : 'Transfer Failed'}
                        </DialogTitle>
                        <DialogDescription>
                            {sender?.label ? `${sender.label} · ` : ''}{sender ? maskPubKey(sender.public_key) : ''}{' → '}{maskPubKey(receiverAddress.trim() || '—')}
                        </DialogDescription>
                    </DialogHeader>

                    <div className="flex flex-col items-center gap-4 py-4">
                        {status === 'loading' && (
                            <span className="size-8 rounded-full border-2 border-blue-500 border-t-transparent animate-spin" />
                        )}

                        {status === 'success' && (
                            <>
                                <svg className="size-10 text-green-500" viewBox="0 0 20 20" fill="currentColor">
                                    <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                                </svg>
                                <p className="text-sm font-semibold text-center">{parseFloat(amountSOL || '0').toFixed(9)} SOL sent</p>
                                {txSignature && (
                                    <a
                                        href={`https://solscan.io/tx/${txSignature}`}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="flex items-center gap-1.5 text-xs text-blue-500 hover:underline"
                                    >
                                        View on Solscan
                                        <ExternalLink className="size-3" />
                                    </a>
                                )}
                            </>
                        )}

                        {status === 'error' && (
                            <>
                                <svg className="size-10 text-destructive" viewBox="0 0 20 20" fill="currentColor">
                                    <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
                                </svg>
                                <p className="text-sm text-destructive text-center">{errorMsg}</p>
                            </>
                        )}
                    </div>

                    {status !== 'loading' && (
                        <DialogFooter>
                            <Button variant="default" onClick={reset}>Done</Button>
                        </DialogFooter>
                    )}
                </DialogContent>
            </Dialog>
        </>
    )
}
