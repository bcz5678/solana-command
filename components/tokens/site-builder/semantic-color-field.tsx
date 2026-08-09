'use client'

// ============================================================================
// Semantic tokens are derived from core when absent (resolveTheme() computes
// a fallback for every one of them) — so an empty value here means "inherit
// the computed default", not "render a literal empty colour". The derived
// value shows as a placeholder, never as a stored value: the swatch previews
// it decoratively, and the text field's native `placeholder` shows it as
// ghosted text. Typing anything sets a real override; clearing it back to
// empty removes the override rather than writing "".
// ============================================================================

import { useId } from 'react'
import { FieldMeta } from '@/site-platform/schema'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

type Props = {
    meta: FieldMeta
    value: string | undefined
    derived: string | undefined
    onChange: (value: string | undefined) => void
}

export default function SemanticColorField({ meta, value, derived, onChange }: Props) {
    const id = useId()

    return (
        <div className="flex flex-col gap-1.5">
            <Label htmlFor={id}>{meta.label}</Label>
            <div className="flex items-center gap-2">
                <input
                    type="color"
                    // Decorative only: a native colour input can't represent
                    // "unset", so it always shows something, but onChange below
                    // is the only thing that ever writes a real override.
                    value={value || derived || '#000000'}
                    onChange={(e) => onChange(e.target.value)}
                    className="size-8 shrink-0 cursor-pointer rounded-md border border-input bg-transparent p-0.5"
                />
                <Input
                    id={id}
                    type="text"
                    value={value ?? ''}
                    placeholder={derived ?? 'inherit'}
                    onChange={(e) => onChange(e.target.value === '' ? undefined : e.target.value)}
                    className="max-w-40 font-mono text-sm"
                />
            </div>
            {meta.help && <p className="text-xs text-muted-foreground">{meta.help}</p>}
            {!value && derived && (
                <p className="text-xs text-muted-foreground">Inherits {derived} unless overridden.</p>
            )}
        </div>
    )
}
