'use client'

import { Button } from '@/components/ui/button'
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogDescription,
    DialogFooter,
} from '@/components/ui/dialog'

export type EdgeStatus = 'pending' | 'loading' | 'success' | 'error'

export interface TransferEdgeDisplay {
    key:       string | number
    fromLabel: string
    toLabel:   string | null
    toAddress: string
    amount:    string
}

type Props = {
    open:         boolean
    onOpenChange: (open: boolean) => void
    edges:        TransferEdgeDisplay[]
    statuses:     EdgeStatus[]
    symbolLabel:  string
    done:         boolean
    /** Re-fires just this one transfer. Only called for a row currently 'error'. */
    onRetry:      (index: number) => void
    onDone:       () => void
}

function maskPubKey(key: string) {
    return `${key.slice(0, 7)}....${key.slice(-7)}`
}

/**
 * Shared execution/progress dialog for every token-transfer form (many-to-many,
 * many-to-one, ...) — one place for the retry-a-single-failed-transfer button
 * so every form that adopts this dialog gets it for free instead of
 * reimplementing the same status list + retry plumbing per form.
 */
export default function TransferProgressDialog({ open, onOpenChange, edges, statuses, symbolLabel, done, onRetry, onDone }: Props) {
    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-md">
                <DialogHeader>
                    <DialogTitle>{done ? 'Transfers Complete' : 'Transferring…'}</DialogTitle>
                    <DialogDescription>{edges.length} transfer{edges.length !== 1 ? 's' : ''}</DialogDescription>
                </DialogHeader>

                <div className="flex max-h-80 flex-col divide-y overflow-y-auto">
                    {edges.map((e, i) => {
                        const status = statuses[i] ?? 'pending'
                        return (
                            <div key={e.key} className="flex items-center gap-3 py-3">
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
                                {status === 'error' && (
                                    <button
                                        type="button"
                                        onClick={() => onRetry(i)}
                                        className="shrink-0 rounded border border-blue-500/60 bg-blue-500/10 px-2 py-1 text-[10px] font-medium text-blue-500 hover:bg-blue-500/20 transition-colors"
                                    >
                                        Retry
                                    </button>
                                )}
                            </div>
                        )
                    })}
                </div>

                {done && (() => {
                    const total    = edges.length
                    const success  = statuses.filter((s) => s === 'success').length
                    const failed   = statuses.filter((s) => s === 'error').length
                    const inFlight = total - success - failed // a retry currently in progress
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
                                    : `${success} succeeded, ${failed} failed${inFlight > 0 ? `, ${inFlight} retrying` : ''}. Retry a transfer above, or check wallet balances.`}
                            </div>
                            <DialogFooter>
                                <Button variant="default" onClick={onDone}>Done</Button>
                            </DialogFooter>
                        </>
                    )
                })()}
            </DialogContent>
        </Dialog>
    )
}
