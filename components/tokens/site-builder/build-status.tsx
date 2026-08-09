'use client'

// ============================================================================
// Build step 10 — Realtime progress. Form spec.md > API contracts > Build
// status: subscribe via useBuildStatus (Supabase Realtime on private.builds),
// never poll. This component only renders whatever that hook already has.
// ============================================================================

import { CheckCircle2, XCircle, Loader2 } from 'lucide-react'
import { BuildRow } from '@/lib/sites/types'

const STEPS: BuildRow['status'][] = [
    'queued', 'claimed', 'validating', 'rendering', 'uploading', 'invalidating', 'live',
]

type Props = {
    build: BuildRow | null
    domain: string | null
}

export default function BuildStatus({ build, domain }: Props) {
    if (!build) {
        return <p className="text-xs text-muted-foreground">No build yet.</p>
    }

    const stepIndex = STEPS.indexOf(build.status)
    const failed = build.status === 'failed'
    const cancelled = build.status === 'cancelled'
    const inProgress = !failed && !cancelled && build.status !== 'live'

    // validation_issues may arrive as its own column or nested inside
    // error_detail, depending on how orchestrator_report_status shaped it —
    // see the note on BuildRow in lib/sites/types.ts.
    const validationIssues = build.validation_issues
        ?? (build.error_detail?.validation_issues as BuildRow['validation_issues'] | undefined)
        ?? null

    return (
        <div className="flex flex-col gap-2">
            {!failed && !cancelled && (
                <div className="flex flex-wrap items-center gap-1.5">
                    {STEPS.map((step, i) => (
                        <span
                            key={step}
                            className={[
                                'rounded-full px-2 py-0.5 text-xs',
                                i < stepIndex
                                    ? 'bg-emerald-500/15 text-emerald-600'
                                    : i === stepIndex
                                        ? 'bg-blue-500/15 font-medium text-blue-600'
                                        : 'bg-muted text-muted-foreground',
                            ].join(' ')}
                        >
                            {step}
                        </span>
                    ))}
                </div>
            )}

            {build.status === 'live' && domain && (
                <a
                    href={`https://${domain}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex w-fit items-center gap-1 text-xs text-emerald-600 underline-offset-2 hover:underline"
                >
                    <CheckCircle2 className="size-3.5" /> Live at {domain}
                </a>
            )}

            {inProgress && (
                <span className="flex items-center gap-1 text-xs text-muted-foreground">
                    <Loader2 className="size-3.5 animate-spin" /> {build.status}…
                </span>
            )}

            {failed && (
                <div className="flex flex-col gap-1">
                    <span className="flex items-center gap-1 text-xs font-medium text-destructive">
                        <XCircle className="size-3.5" /> Build failed
                    </span>
                    {typeof build.error_detail?.message === 'string' && (
                        <p className="text-xs text-destructive">{build.error_detail.message}</p>
                    )}
                    {validationIssues && validationIssues.length > 0 && (
                        <p className="text-xs text-muted-foreground">
                            {validationIssues.length} validation issue{validationIssues.length === 1 ? '' : 's'} — marked on the fields above.
                        </p>
                    )}
                </div>
            )}

            {cancelled && (
                <span className="text-xs text-muted-foreground">Build cancelled.</span>
            )}
        </div>
    )
}
