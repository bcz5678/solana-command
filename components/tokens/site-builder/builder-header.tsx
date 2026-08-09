'use client'

// ============================================================================
// Build step 8 — "Show a count in the header. Clicking it jumps to the first
// error." Save status moved here from the ad-hoc row in site-config.tsx now
// that there's a real header, matching Form spec.md's component tree
// (BuilderHeader: save state, validation count, Publish).
//
// Build step 10 adds Publish + the optional note field. Publish stays
// disabled while there are client-side errors — Form spec.md > Behaviour >
// Publish step 1: "Client-side validate; block and jump to the first error if
// any" — so there's no point sending a request the server will 422 anyway.
// ============================================================================

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

const STATUS_LABEL: Record<string, string> = {
    idle: 'Idle',
    loading: 'Loading…',
    saving: 'Saving…',
    saved: 'Saved',
    error: 'Error',
}

type Props = {
    status: string
    savedAt: string | null
    errorCount: number
    warningCount: number
    onJumpToFirstError: () => void
    note: string
    onNoteChange: (note: string) => void
    publishing: boolean
    onPublish: () => void
}

export default function BuilderHeader({
    status, savedAt, errorCount, warningCount, onJumpToFirstError,
    note, onNoteChange, publishing, onPublish,
}: Props) {
    return (
        <div className="flex flex-wrap items-center gap-3">
            <Badge variant={status === 'error' ? 'destructive' : 'outline'}>
                {STATUS_LABEL[status] ?? status}
            </Badge>

            {savedAt && (
                <span className="text-xs text-muted-foreground">
                    Last saved {new Date(savedAt).toLocaleTimeString()}
                </span>
            )}

            {errorCount > 0 && (
                <button
                    type="button"
                    onClick={onJumpToFirstError}
                    className="text-xs text-destructive underline-offset-2 hover:underline"
                >
                    {errorCount} error{errorCount === 1 ? '' : 's'}
                </button>
            )}

            {warningCount > 0 && (
                <span className="text-xs text-amber-600">
                    {warningCount} warning{warningCount === 1 ? '' : 's'}
                </span>
            )}

            <div className="ml-auto flex items-center gap-2">
                <Input
                    value={note}
                    onChange={(e) => onNoteChange(e.target.value)}
                    placeholder="Publish note (optional)"
                    className="h-7 w-48 text-xs"
                />
                <Button
                    size="sm"
                    disabled={errorCount > 0 || publishing}
                    onClick={onPublish}
                >
                    {publishing ? 'Publishing…' : 'Publish'}
                </Button>
            </div>
        </div>
    )
}
