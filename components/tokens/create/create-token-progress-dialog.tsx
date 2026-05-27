'use client'

import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogDescription,
    DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { CheckCircle2, XCircle, Loader2 } from 'lucide-react'

export type StepStatus = 'idle' | 'loading' | 'success' | 'error'

export interface TokenCreationStep {
    label: string
    status: StepStatus
    error?: string
}

export type TokenCreationSteps = {
    claimVanityMint: StepStatus
    uploadTokenImage: StepStatus
    uploadTokenMeta: StepStatus
    buildToken: StepStatus
    storeInDb: StepStatus
    updateVanityMint: StepStatus
}

const STEP_LABELS: { key: keyof TokenCreationSteps; label: string }[] = [
    { key: 'claimVanityMint', label: 'Claiming Vanity Mint' },
    { key: 'uploadTokenImage', label: 'Uploading Token Image to AWS' },
    { key: 'uploadTokenMeta', label: 'Uploading Token Meta to AWS' },
    { key: 'buildToken', label: 'Building Token' },
    { key: 'storeInDb', label: 'Storing Token in DB' },
    { key: 'updateVanityMint', label: 'Updating Vanity Mint' },
]

export const INITIAL_STEPS: TokenCreationSteps = {
    claimVanityMint: 'idle',
    uploadTokenImage: 'idle',
    uploadTokenMeta: 'idle',
    buildToken: 'idle',
    storeInDb: 'idle',
    updateVanityMint: 'idle',
}

interface Props {
    open: boolean
    steps: TokenCreationSteps
    errorMessage?: string
    onClose?: () => void
}

function StepRow({ label, status }: { label: string; status: StepStatus }) {
    return (
        <div className="flex items-center gap-3 py-2">
            <span className="flex size-5 shrink-0 items-center justify-center">
                {status === 'loading' && (
                    <Loader2 className="size-4 animate-spin text-primary" />
                )}
                {status === 'success' && (
                    <CheckCircle2 className="size-4 text-green-500" />
                )}
                {status === 'error' && (
                    <XCircle className="size-4 text-destructive" />
                )}
                {status === 'idle' && (
                    <span className="size-2 rounded-full bg-muted-foreground/30" />
                )}
            </span>
            <span
                className={cn(
                    'text-sm',
                    status === 'idle' && 'text-muted-foreground',
                    status === 'loading' && 'font-medium text-foreground',
                    status === 'success' && 'text-foreground',
                    status === 'error' && 'text-destructive',
                )}
            >
                {label}
            </span>
        </div>
    )
}

function deriveOverallStatus(steps: TokenCreationSteps): 'running' | 'success' | 'error' {
    const statuses = Object.values(steps) as StepStatus[]
    if (statuses.some((s) => s === 'error')) return 'error'
    if (statuses.every((s) => s === 'success')) return 'success'
    return 'running'
}

export default function CreateTokenProgressDialog({ open, steps, errorMessage, onClose }: Props) {
    const overall = deriveOverallStatus(steps)
    const isDone = overall === 'success' || overall === 'error'

    return (
        <Dialog open={open} onOpenChange={(v) => { if (!v && isDone) onClose?.() }}>
            <DialogContent showCloseButton={isDone} className="sm:max-w-sm">
                <DialogHeader>
                    <DialogTitle>
                        {overall === 'success'
                            ? 'Token Created'
                            : overall === 'error'
                            ? 'Creation Failed'
                            : 'Creating Token…'}
                    </DialogTitle>
                    <DialogDescription>
                        {overall === 'success'
                            ? 'Your token has been successfully created.'
                            : overall === 'error'
                            ? 'An error occurred. See details below.'
                            : 'Please wait while your token is being created.'}
                    </DialogDescription>
                </DialogHeader>

                <div className="-mx-1 divide-y divide-border/50 rounded-lg border px-1">
                    {STEP_LABELS.map(({ key, label }) => (
                        <StepRow key={key} label={label} status={steps[key]} />
                    ))}
                </div>

                {overall === 'error' && errorMessage && (
                    <div className="flex items-start gap-2 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
                        <XCircle className="mt-0.5 size-4 shrink-0" />
                        <span>{errorMessage}</span>
                    </div>
                )}

                {isDone && (
                    <DialogFooter>
                        <Button variant="outline" onClick={onClose}>
                            Close
                        </Button>
                    </DialogFooter>
                )}
            </DialogContent>
        </Dialog>
    )
}
