'use client'

// ============================================================================
// Build step 3 of site-platform/docs/Form spec.md — the widget mapper. Step 4
// added the `repeater` case (string arrays only — see the note below).
//
// One place that maps a field's declared `widget` to a component. Adding a
// field to the schema (with `field(schema, meta)`) makes it appear here with
// no change to this file — see CLAUDE.md > Invariant 2.
// ============================================================================

import { useId } from 'react'
import { z } from 'zod'
import { Plus, Trash2, ChevronUp, ChevronDown } from 'lucide-react'
import { getFieldMeta, FieldMeta, FieldWidget, ValidationIssue } from '@/site-platform/schema'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { moveItem } from './repeater-utils'
import { fieldElementId, issuesForPath } from './validation'

type Props = {
    schema: z.ZodType
    value: unknown
    onChange: (value: unknown) => void
    /**
     * This field's dotted path in the definition (e.g. "hero.title",
     * "sections[<id>].navLabel") — build step 8. Omit for a field with no
     * stable path yet (e.g. inside a not-yet-path-aware sub-form); it just
     * renders without marking, same as before step 8.
     */
    path?: string
    issues?: ValidationIssue[]
}

/**
 * Widgets later build steps back with real infrastructure. `repeater` here
 * only covers `string[]` (build step 4's `hero.body`) — an array of *objects*
 * (sections, social links, CTAs) needs a per-item sub-form the generic mapper
 * can't derive, so those get their own bespoke editor instead of this widget.
 */
const UNSUPPORTED_WIDGETS: Partial<Record<FieldWidget, string>> = {
    image: 'media upload (build step 5)',
    focalPoint: 'media upload (build step 5)',
    icon: 'icon picker',
}

export default function SchemaField({ schema, value, onChange, path, issues }: Props) {
    const reactId = useId()
    const id = path ? fieldElementId(path) : reactId
    const meta = getFieldMeta(schema)

    // No metadata registered — nothing to key the widget, label, or grouping
    // off of. Per CLAUDE.md, the fix is adding field() to the schema, not a
    // hardcoded branch here.
    if (!meta) return null

    const matched = path && issues ? issuesForPath(issues, path) : []
    const error = matched.find((i) => i.severity === 'error')
    const warnings = matched.filter((i) => i.severity === 'warning')

    return (
        <div id={id} className="flex flex-col gap-1.5">
            {meta.widget !== 'toggle' && (
                <Label htmlFor={reactId}>{meta.label}</Label>
            )}
            <FieldWidgetInput id={reactId} meta={meta} value={value} onChange={onChange} invalid={Boolean(error)} />
            {meta.help && (
                <p className="text-xs text-muted-foreground">{meta.help}</p>
            )}
            {/* Errors block publish; warnings show inline and never block — Form spec.md > Behaviour > Validation. */}
            {error && <p className="text-xs text-destructive">{error.message}</p>}
            {warnings.map((w, i) => (
                <p key={i} className="text-xs text-amber-600">{w.message}</p>
            ))}
        </div>
    )
}

function FieldWidgetInput({
    id, meta, value, onChange, invalid,
}: {
    id: string
    meta: FieldMeta
    value: unknown
    onChange: (value: unknown) => void
    invalid: boolean
}) {
    const widget = meta.widget ?? 'text'
    const stringValue = typeof value === 'string' ? value : ''

    if (widget in UNSUPPORTED_WIDGETS) {
        return (
            <p className="text-xs text-muted-foreground italic">
                &ldquo;{widget}&rdquo; needs {UNSUPPORTED_WIDGETS[widget]} — not wired up yet.
            </p>
        )
    }

    switch (widget) {
        case 'text':
        case 'slug':
            return (
                <Input
                    id={id}
                    type="text"
                    value={stringValue}
                    placeholder={meta.placeholder}
                    aria-invalid={invalid}
                    onChange={(e) => onChange(e.target.value)}
                />
            )

        case 'url':
            return (
                <Input
                    id={id}
                    type="url"
                    value={stringValue}
                    placeholder={meta.placeholder}
                    aria-invalid={invalid}
                    onChange={(e) => onChange(e.target.value)}
                />
            )

        case 'textarea':
        case 'richtext':
            return (
                <Textarea
                    id={id}
                    value={stringValue}
                    placeholder={meta.placeholder}
                    aria-invalid={invalid}
                    onChange={(e) => onChange(e.target.value)}
                />
            )

        case 'number':
        case 'length':
            return (
                <Input
                    id={id}
                    type={widget === 'number' ? 'number' : 'text'}
                    value={typeof value === 'number' ? value : stringValue}
                    placeholder={meta.placeholder}
                    aria-invalid={invalid}
                    onChange={(e) => {
                        if (widget !== 'number') { onChange(e.target.value); return }
                        onChange(Number.isNaN(e.target.valueAsNumber) ? undefined : e.target.valueAsNumber)
                    }}
                />
            )

        case 'color':
            return (
                <div className="flex items-center gap-2">
                    <input
                        type="color"
                        value={stringValue || '#000000'}
                        onChange={(e) => onChange(e.target.value)}
                        className="size-8 shrink-0 cursor-pointer rounded-md border border-input bg-transparent p-0.5"
                    />
                    <Input
                        id={id}
                        type="text"
                        value={stringValue}
                        placeholder={meta.placeholder}
                        aria-invalid={invalid}
                        onChange={(e) => onChange(e.target.value)}
                        className="max-w-40 font-mono text-sm"
                    />
                </div>
            )

        case 'select':
            return (
                <select
                    id={id}
                    value={stringValue}
                    onChange={(e) => onChange(e.target.value)}
                    className="h-8 rounded-lg border border-input bg-transparent px-2.5 text-sm"
                >
                    <option value="" disabled>Select…</option>
                    {meta.options?.map((opt) => (
                        <option key={opt.value} value={opt.value}>{opt.label}</option>
                    ))}
                </select>
            )

        case 'repeater': {
            const items = Array.isArray(value) ? value.map((v) => (typeof v === 'string' ? v : '')) : []

            return (
                <div className="flex flex-col gap-2">
                    {items.map((item, i) => (
                        <div key={i} className="flex items-start gap-1.5">
                            <Textarea
                                value={item}
                                placeholder={meta.placeholder}
                                onChange={(e) => onChange(items.map((s, j) => (j === i ? e.target.value : s)))}
                                className="min-h-16"
                            />
                            <div className="flex flex-col gap-0.5">
                                <Button
                                    type="button" variant="ghost" size="icon-xs"
                                    disabled={i === 0}
                                    onClick={() => onChange(moveItem(items, i, i - 1))}
                                >
                                    <ChevronUp />
                                </Button>
                                <Button
                                    type="button" variant="ghost" size="icon-xs"
                                    disabled={i === items.length - 1}
                                    onClick={() => onChange(moveItem(items, i, i + 1))}
                                >
                                    <ChevronDown />
                                </Button>
                            </div>
                            <Button
                                type="button" variant="ghost" size="icon-xs"
                                onClick={() => onChange(items.filter((_, j) => j !== i))}
                            >
                                <Trash2 />
                            </Button>
                        </div>
                    ))}
                    <Button
                        type="button" variant="outline" size="sm" className="w-fit"
                        onClick={() => onChange([...items, ''])}
                    >
                        <Plus /> Add
                    </Button>
                </div>
            )
        }

        case 'toggle':
            return (
                <div className="flex items-center gap-2">
                    <Checkbox
                        id={id}
                        checked={Boolean(value)}
                        onCheckedChange={(checked) => onChange(checked === true)}
                    />
                    <Label htmlFor={id}>{meta.label}</Label>
                </div>
            )

        default:
            return null
    }
}

// ============================================================================
// Grouping — shared by any flat (repeater-free) schema section. Sorts by
// `order`, groups by `group`, and hides fields whose `visibleWhen` doesn't
// match a sibling field's current value.
// ============================================================================

export type SchemaFieldEntry = { key: string; schema: z.ZodType; meta: FieldMeta }

export function collectFields(
    shape: Record<string, z.ZodType>,
    values: Record<string, unknown>,
): Map<string, SchemaFieldEntry[]> {
    const entries = Object.entries(shape)
        .map(([key, schema]) => ({ key, schema, meta: getFieldMeta(schema) }))
        .filter((f): f is SchemaFieldEntry => {
            if (!f.meta) return false
            if (f.meta.visibleWhen && values[f.meta.visibleWhen.path] !== f.meta.visibleWhen.equals) return false
            return true
        })
        .sort((a, b) => (a.meta.order ?? 0) - (b.meta.order ?? 0))

    const groups = new Map<string, SchemaFieldEntry[]>()
    for (const entry of entries) {
        const group = entry.meta.group ?? ''
        if (!groups.has(group)) groups.set(group, [])
        groups.get(group)!.push(entry)
    }
    return groups
}

/**
 * Strips `.optional()`/`.default()`/`.nullable()` wrappers to reach a
 * container schema's `.shape` — needed wherever a field is itself declared
 * `SomeSchema.optional()` (SiteModulesSchema's token/countdown/mailingList,
 * DesignTab's theme.semantic) and something needs to walk into it rather than
 * render it directly.
 */
export function unwrap(schema: z.ZodType): z.ZodType {
    if ('unwrap' in schema && typeof (schema as { unwrap?: unknown }).unwrap === 'function') {
        return unwrap((schema as { unwrap: () => z.ZodType }).unwrap())
    }
    return schema
}
