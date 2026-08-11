'use client'

import { useEffect, useState } from 'react'
import { CheckCircle2, XCircle, Loader2, MinusCircle, AlertTriangle, Circle } from 'lucide-react'
import { ProvisioningRun, TimelineEntry, buildTimeline, elapsedMs } from '@/lib/provisioning/client'

/**
 * cert_validation_wait and distribution_deploy legitimately take 1-30 minutes
 * — WIZARD_INTEGRATION.md is explicit that a bare spinner through that is what
 * makes someone reload or re-run mid-cert, which is how a certificate gets
 * orphaned. Naming what's being waited on is the point, not decoration.
 */
const SLOW_STEP_EXPLANATION: Partial<Record<TimelineEntry['step'], string>> = {
    cert_validation_wait: 'Waiting for DNS to propagate so Amazon can verify the domain.',
    distribution_deploy: 'Waiting for CloudFront to finish deploying the distribution.',
}

function formatElapsed(ms: number): string {
    const totalSeconds = Math.floor(ms / 1000)
    const minutes = Math.floor(totalSeconds / 60)
    const seconds = totalSeconds % 60
    return minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`
}

function StateIcon({ state }: { state: TimelineEntry['state'] }) {
    switch (state) {
        // Pending and running both spin — a step waiting its turn reads as
        // "in progress" the same way the active one does, dimmed just enough
        // to keep which step is actually running legible at a glance.
        case 'pending':
            return <Loader2 className="size-4 animate-spin text-muted-foreground/40" />
        case 'running':
            return <Loader2 className="size-4 animate-spin text-primary" />
        case 'succeeded':
            return <CheckCircle2 className="size-4 text-green-500" />
        case 'failed':
            return <XCircle className="size-4 text-destructive" />
        case 'blocked':
            return <AlertTriangle className="size-4 text-amber-500" />
        case 'skipped':
            return <MinusCircle className="size-4 text-muted-foreground/50" />
        default:
            return <Circle className="size-3.5 text-muted-foreground/30" />
    }
}

type Props = {
    run: ProvisioningRun
}

/**
 * One row per planned step, including skips — buildTimeline() supplies the
 * full ordered list from the plan, not just what has events yet, so the run
 * doesn't look like it has fewer stages than it actually does.
 */
export default function ProvisioningTimeline({ run }: Props) {
    const timeline = buildTimeline(run)
    const hasSlowRunning = timeline.some((entry) => entry.isSlow)

    // buildTimeline()'s output only changes when `run` changes (a Realtime
    // refetch); the elapsed-time label needs to keep ticking in between.
    const [, forceTick] = useState(0)
    useEffect(() => {
        if (!hasSlowRunning) return
        const interval = setInterval(() => forceTick((n) => n + 1), 1000)
        return () => clearInterval(interval)
    }, [hasSlowRunning])

    return (
        <div className="-mx-1 divide-y divide-border/50 rounded-lg border px-3">
            {timeline.map((entry) => {
                const elapsed = entry.isSlow ? elapsedMs(entry) : null

                return (
                    <div key={entry.step} className="flex items-start gap-3 py-2">
                        <span className="flex size-5 shrink-0 items-center justify-center mt-0.5">
                            <StateIcon state={entry.state} />
                        </span>
                        <span className="flex flex-1 min-w-0 flex-col">
                            <span className={[
                                'text-sm',
                                entry.state === 'pending' || entry.state === 'skipped' ? 'text-muted-foreground' : 'text-foreground',
                                entry.state === 'failed' ? 'text-destructive' : '',
                            ].join(' ')}>
                                {entry.label}
                                {elapsed !== null && (
                                    <span className="text-muted-foreground font-normal">
                                        {' — '}{formatElapsed(elapsed)}
                                        {entry.attempts > 1 ? `, attempt ${entry.attempts}` : ''}
                                    </span>
                                )}
                                {!entry.isSlow && entry.state === 'succeeded' && entry.durationMs !== null && (
                                    <span className="text-muted-foreground font-normal"> — {formatElapsed(entry.durationMs)}</span>
                                )}
                            </span>

                            {entry.isSlow && SLOW_STEP_EXPLANATION[entry.step] && (
                                <span className="text-xs text-muted-foreground">{SLOW_STEP_EXPLANATION[entry.step]}</span>
                            )}
                            {!entry.isSlow && entry.reason && (
                                entry.state === 'skipped' || entry.state === 'blocked' || entry.state === 'failed'
                            ) && (
                                <span className="text-xs text-muted-foreground">{entry.reason}</span>
                            )}
                        </span>
                    </div>
                )
            })}
        </div>
    )
}
