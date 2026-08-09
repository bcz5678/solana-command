'use client'

// ============================================================================
// Build step 4's CTA sub-form (site-platform/docs/Form spec.md > Build order).
//
// Not the generic `repeater` widget — `ctas` holds objects, and SchemaField's
// repeater case only covers `string[]` (see schema-field.tsx). Each item's
// fields still come from SchemaField/collectFields over SiteCtaSchema, so
// adding a field to that schema still needs no change here.
//
// Keyed by array index: SiteCtaSchema has no `id` (unlike sections/social
// links), and every field below is a controlled input driven straight from
// the item's own value — reordering can't strand upload/async state on the
// wrong node the way CLAUDE.md's index-keying warning is about.
// ============================================================================

import { Plus, Trash2, ChevronUp, ChevronDown } from 'lucide-react'
import { SiteCtaSchema } from '@/site-platform/schema'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import SchemaField, { collectFields } from './schema-field'
import { moveItem } from './repeater-utils'

type Cta = Record<string, unknown>

type Props = {
    value: Cta[]
    onChange: (next: Cta[]) => void
}

const EMPTY_CTA: Cta = { label: '', href: '', external: false, variant: 'primary' }

export default function CtaEditor({ value, onChange }: Props) {
    return (
        <div className="flex flex-col gap-2">
            {value.map((item, i) => {
                const fields = [...collectFields(SiteCtaSchema.shape, item).values()].flat()

                return (
                    <Card key={i}>
                        <CardContent className="flex items-start gap-2 pt-2">
                            <div className="flex flex-1 flex-col gap-3">
                                {fields.map(({ key, schema }) => (
                                    <SchemaField
                                        key={key}
                                        schema={schema}
                                        value={item[key]}
                                        onChange={(next) => onChange(value.map((v, j) => (j === i ? { ...item, [key]: next } : v)))}
                                    />
                                ))}
                            </div>
                            <div className="flex flex-col gap-0.5">
                                <Button
                                    type="button" variant="ghost" size="icon-xs"
                                    disabled={i === 0}
                                    onClick={() => onChange(moveItem(value, i, i - 1))}
                                >
                                    <ChevronUp />
                                </Button>
                                <Button
                                    type="button" variant="ghost" size="icon-xs"
                                    disabled={i === value.length - 1}
                                    onClick={() => onChange(moveItem(value, i, i + 1))}
                                >
                                    <ChevronDown />
                                </Button>
                                <Button
                                    type="button" variant="ghost" size="icon-xs"
                                    onClick={() => onChange(value.filter((_, j) => j !== i))}
                                >
                                    <Trash2 />
                                </Button>
                            </div>
                        </CardContent>
                    </Card>
                )
            })}
            <Button
                type="button" variant="outline" size="sm" className="w-fit"
                onClick={() => onChange([...value, { ...EMPTY_CTA }])}
            >
                <Plus /> Add button
            </Button>
        </div>
    )
}
