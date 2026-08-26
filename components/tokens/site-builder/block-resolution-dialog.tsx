'use client'

import { useState } from 'react'
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { blockGuidance, resolveBlock, ProvisioningRun } from '@/lib/provisioning/client'

type Props = {
    siteId: string
    run: ProvisioningRun
    /** Called after any resolution succeeds — Realtime will also bring the
     *  run's new state in, this just lets the caller close/react immediately. */
    onResolved: () => void
}

type PendingAction = 'confirm' | 'retry' | 'abandon' | null

/**
 * The one place provisioning genuinely needs a human — almost always
 * domain_purchase, where a run died between the Namecheap call and its
 * result and nothing can tell whether money was spent.
 *
 * Confirming a purchase block requires a note (the order reference the
 * operator verified) — enforced here so a missing note is a disabled button,
 * not a 400 after the click. Abandon is deliberately a second, separately
 * confirmed step: it cancels the run entirely.
 */
export default function BlockResolutionDialog({ siteId, run, onResolved }: Props) {
    const guidance = blockGuidance(run)
    // domain_purchase never auto-retries, by design: no automated check can
    // tell "the registrar took the order and our process died" apart from
    // "the order never landed," which is the entire reason this step blocks
    // instead of failing. Retry would requeue the run with nothing left to
    // ever act on it a second time — confirm or abandon are the only honest
    // options here.
    const isPurchaseBlock = run.blockedStep === 'domain_purchase'

    const [note, setNote] = useState('')
    const [pendingAction, setPendingAction] = useState<PendingAction>(null)
    const [confirmingAbandon, setConfirmingAbandon] = useState(false)
    const [error, setError] = useState<string | null>(null)

    const noteMissing = guidance.requiresNote && !note.trim()

    async function resolve(resolution: 'confirm' | 'retry' | 'abandon') {
        if (resolution === 'confirm' && noteMissing) return

        setPendingAction(resolution)
        setError(null)

        try {
            await resolveBlock(siteId, run.id, resolution, note.trim() || undefined)
            onResolved()
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to resolve')
            setPendingAction(null)
        }
    }

    return (
        <Dialog open>
            <DialogContent className="sm:max-w-md" showCloseButton={false}>
                <DialogHeader>
                    <DialogTitle>{guidance.title}</DialogTitle>
                    <DialogDescription>{guidance.body}</DialogDescription>
                </DialogHeader>

                {guidance.requiresNote && (
                    <div className="flex flex-col gap-1.5">
                        <Label htmlFor="block-note" className="text-xs font-medium text-muted-foreground">
                            Namecheap order reference you verified
                        </Label>
                        <Textarea
                            id="block-note"
                            value={note}
                            onChange={(e) => setNote(e.target.value)}
                            placeholder="e.g. Namecheap order #123456789"
                            rows={2}
                        />
                    </div>
                )}

                {error && <p className="text-sm text-destructive">{error}</p>}

                {confirmingAbandon ? (
                    <div className="flex flex-col gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3">
                        <p className="text-sm">
                            Abandon this run? This cancels it entirely — nothing already
                            completed is undone, but nothing further happens automatically.
                        </p>
                        <div className="flex justify-end gap-2">
                            <Button variant="outline" size="sm" onClick={() => setConfirmingAbandon(false)} disabled={pendingAction !== null}>
                                Back
                            </Button>
                            <Button variant="destructive" size="sm" onClick={() => resolve('abandon')} disabled={pendingAction !== null}>
                                {pendingAction === 'abandon' ? 'Abandoning…' : 'Abandon Run'}
                            </Button>
                        </div>
                    </div>
                ) : (
                    <>
                        {isPurchaseBlock && (
                            <p className="text-xs text-muted-foreground">
                                Verify the order in the Namecheap account, then confirm with the order
                                reference above, or abandon if no order exists.
                            </p>
                        )}
                        <DialogFooter className="items-center sm:justify-between">
                            <Button
                                variant="ghost"
                                size="sm"
                                className="text-destructive hover:text-destructive"
                                onClick={() => setConfirmingAbandon(true)}
                                disabled={pendingAction !== null}
                            >
                                Abandon
                            </Button>
                            <div className="flex gap-2">
                                {!isPurchaseBlock && (
                                    <Button variant="outline" onClick={() => resolve('retry')} disabled={pendingAction !== null}>
                                        {pendingAction === 'retry' ? 'Retrying…' : guidance.retryLabel}
                                    </Button>
                                )}
                                <Button onClick={() => resolve('confirm')} disabled={pendingAction !== null || noteMissing}>
                                    {pendingAction === 'confirm' ? 'Confirming…' : guidance.confirmLabel}
                                </Button>
                            </div>
                        </DialogFooter>
                    </>
                )}
            </DialogContent>
        </Dialog>
    )
}
