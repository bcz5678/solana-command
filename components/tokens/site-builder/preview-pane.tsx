'use client'

// ============================================================================
// Build step 7 of site-platform/docs/Form spec.md — debounced iframe.
//
// "Everything before this is verifiable without it; this is where it becomes
// usable." POST /api/sites/:siteId/preview calls the exact same
// renderDefinition() the real build calls, so this can't structurally drift
// from production output.
// ============================================================================

import { usePreview } from '@/lib/sites/client'
import { SiteDefinition } from '@/site-platform/schema'

type Props = {
    siteId: string
    definition: Partial<SiteDefinition>
}

export default function PreviewPane({ siteId, definition }: Props) {
    const { html, issues, assetCount, loading, error } = usePreview(siteId, definition)

    return (
        <div className="flex flex-col gap-2">
            <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground">
                    {loading ? 'Rendering…' : `${assetCount} asset${assetCount === 1 ? '' : 's'}`}
                </span>
                {issues.length > 0 && (
                    <span className="text-xs text-amber-600">
                        {issues.length} issue{issues.length === 1 ? '' : 's'}
                    </span>
                )}
            </div>

            {error && <p className="text-xs text-destructive">{error}</p>}

            {html ? (
                <iframe
                    sandbox="allow-scripts"
                    srcDoc={html}
                    title="Site preview"
                    className="h-[600px] w-full rounded-md border border-input bg-white"
                />
            ) : (
                <div className="flex h-[600px] w-full items-center justify-center rounded-md border border-dashed border-input text-sm text-muted-foreground">
                    Nothing to preview yet
                </div>
            )}

            {issues.length > 0 && (
                <details className="text-xs text-muted-foreground">
                    <summary className="cursor-pointer">View issues (raw — build step 8 maps these to fields)</summary>
                    <pre className="mt-1 overflow-auto rounded-md bg-muted p-2">{JSON.stringify(issues, null, 2)}</pre>
                </details>
            )}
        </div>
    )
}
