'use client'

// ============================================================================
// Build step 9 of site-platform/docs/Form spec.md — manifest-driven, tokenized
// only. Rendered only when showsDesignTab(manifest) — the caller's job; a
// slotted template's fixed look means usesThemeKeys/customThemeSchema are
// both empty and this component would render nothing anyway, but the picker
// (build step 2, via configurabilityLabel) already says so up front rather
// than showing an empty tab.
//
// Two tiers, two different rendering paths:
//   - usesThemeKeys: dotted paths into theme.core / theme.semantic. Each one
//     resolves to a real field() schema (CoreTokensSchema/SemanticTokensSchema
//     already annotate their fields — see theme.ts), so this reuses
//     SchemaField exactly like every other step, EXCEPT semantic.* keys: those
//     are derived from core when absent (resolveTheme() computes a fallback
//     for every one), so they render through SemanticColorField instead —
//     empty means "inherit the computed value", not "literal empty colour".
//     A key the manifest declares with no matching annotated field is a real
//     manifest/schema mismatch, not just an unfinished form — warn, don't
//     silently drop it.
//   - customThemeSchema: Tier 3, template-scoped knobs declared as plain
//     {type,label,default,options} records, not backed by a Zod schema — so
//     they get their own small type->widget mapping below, writing to
//     theme.templates[manifest.id].
// ============================================================================

import { useMemo } from 'react'
import { z } from 'zod'
import { getFieldMeta, LayeredThemeSchema, TemplateManifest } from '@/site-platform/schema'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Checkbox } from '@/components/ui/checkbox'
import SchemaField, { unwrap } from './schema-field'
import SemanticColorField from './semantic-color-field'
import { getPath, setPath } from './deep-path'
import { tryResolveDerivedVars, SEMANTIC_CSS_VAR } from './derived-theme'

type Props = {
    manifest: TemplateManifest
    value: Record<string, unknown> | undefined
    onChange: (next: Record<string, unknown>) => void
}

/** Walks a dotted path through nested ZodObjects, unwrapping .optional()/.default() containers along the way. Returns the leaf schema exactly as registered (so getFieldMeta's identity-keyed lookup still matches). */
function resolveSchemaPath(schema: z.ZodType, path: string): z.ZodType | undefined {
    const [key, ...rest] = path.split('.')
    const container = unwrap(schema)
    if (!(container instanceof z.ZodObject)) return undefined

    const next = container.shape[key]
    if (!next) return undefined
    if (rest.length === 0) return next

    return resolveSchemaPath(next, rest.join('.'))
}

export default function DesignTab({ manifest, value, onChange }: Props) {
    const theme = value ?? {}
    const custom = manifest.customThemeSchema ?? {}
    const customEntries = Object.entries(custom)

    // Same computation regardless of which key is being rendered — done once
    // per render rather than per key. null until enough of theme.core.colors
    // is filled in for a real derivation (see derived-theme.ts).
    const derivedVars = useMemo(
        () => tryResolveDerivedVars(theme, manifest),
        [theme, manifest],
    )

    return (
        <div className="flex flex-col gap-5">
            {manifest.usesThemeKeys.length > 0 && (
                <div className="flex flex-col gap-3">
                    {manifest.usesThemeKeys.map((path) => {
                        const schema = resolveSchemaPath(LayeredThemeSchema, path)

                        if (!schema) {
                            // A key the manifest declares but the shared theme
                            // schema doesn't define (or hasn't annotated with
                            // field()) is a manifest/schema mismatch, not
                            // ordinary unfinished form work — worth knowing
                            // about even though there's nothing to render.
                            console.warn(
                                `[DesignTab] "${manifest.id}" declares usesThemeKeys entry "${path}" with no matching field() metadata — skipping.`,
                            )
                            return null
                        }

                        const meta = getFieldMeta(schema)
                        const semanticKey = path.startsWith('semantic.') ? path.slice('semantic.'.length) : null

                        if (semanticKey && meta) {
                            const cssVar = SEMANTIC_CSS_VAR[semanticKey]
                            return (
                                <SemanticColorField
                                    key={path}
                                    meta={meta}
                                    value={getPath(theme, path) as string | undefined}
                                    derived={cssVar ? derivedVars?.[cssVar] : undefined}
                                    onChange={(next) => onChange(setPath(theme, path, next))}
                                />
                            )
                        }

                        return (
                            <SchemaField
                                key={path}
                                schema={schema}
                                value={getPath(theme, path)}
                                onChange={(next) => onChange(setPath(theme, path, next))}
                                path={`theme.${path}`}
                            />
                        )
                    })}
                </div>
            )}

            {customEntries.length > 0 && (
                <div className="flex flex-col gap-3">
                    <h3 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                        {manifest.name}-specific
                    </h3>
                    {customEntries.map(([key, field]) => {
                        const path = `templates.${manifest.id}.${key}`
                        const current = getPath(theme, path)

                        return (
                            <CustomThemeField
                                key={key}
                                label={field.label}
                                type={field.type}
                                options={field.options}
                                value={current !== undefined ? current : field.default}
                                onChange={(next) => onChange(setPath(theme, path, next))}
                            />
                        )
                    })}
                </div>
            )}
        </div>
    )
}

function CustomThemeField({
    label, type, options, value, onChange,
}: {
    label: string
    type: 'color' | 'length' | 'number' | 'select' | 'boolean'
    options?: string[]
    value: unknown
    onChange: (value: unknown) => void
}) {
    const stringValue = typeof value === 'string' ? value : ''

    return (
        <div className="flex flex-col gap-1.5">
            {type !== 'boolean' && <Label>{label}</Label>}

            {type === 'color' && (
                <div className="flex items-center gap-2">
                    <input
                        type="color"
                        value={stringValue || '#000000'}
                        onChange={(e) => onChange(e.target.value)}
                        className="size-8 shrink-0 cursor-pointer rounded-md border border-input bg-transparent p-0.5"
                    />
                    <Input
                        type="text"
                        value={stringValue}
                        onChange={(e) => onChange(e.target.value)}
                        className="max-w-40 font-mono text-sm"
                    />
                </div>
            )}

            {(type === 'length' || type === 'number') && (
                <Input
                    type={type === 'number' ? 'number' : 'text'}
                    value={typeof value === 'number' ? value : stringValue}
                    onChange={(e) => {
                        if (type === 'length') { onChange(e.target.value); return }
                        onChange(Number.isNaN(e.target.valueAsNumber) ? undefined : e.target.valueAsNumber)
                    }}
                />
            )}

            {type === 'select' && (
                <select
                    value={stringValue}
                    onChange={(e) => onChange(e.target.value)}
                    className="h-8 rounded-lg border border-input bg-transparent px-2.5 text-sm"
                >
                    <option value="" disabled>Select…</option>
                    {options?.map((opt) => (
                        <option key={opt} value={opt}>{opt}</option>
                    ))}
                </select>
            )}

            {type === 'boolean' && (
                <div className="flex items-center gap-2">
                    <Checkbox checked={Boolean(value)} onCheckedChange={(checked) => onChange(checked === true)} />
                    <Label>{label}</Label>
                </div>
            )}
        </div>
    )
}
