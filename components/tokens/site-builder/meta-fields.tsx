'use client'

// ============================================================================
// Build step 3 proof surface — SiteMetaSchema is flat (no repeaters), so it
// exercises SchemaField's group/order/widget mapping without dragging in
// repeater or media infrastructure from later steps.
// ============================================================================

import { SiteMetaSchema, ValidationIssue } from '@/site-platform/schema'
import SchemaField, { collectFields } from './schema-field'

type Props = {
    value: Record<string, unknown>
    onChange: (next: Record<string, unknown>) => void
    /** Build step 8 — issues whose path starts with "meta.". */
    issues?: ValidationIssue[]
}

export default function MetaFields({ value, onChange, issues }: Props) {
    const groups = collectFields(SiteMetaSchema.shape, value)

    return (
        <div className="flex flex-col gap-5">
            {[...groups.entries()].map(([group, fields]) => (
                <div key={group || 'ungrouped'} className="flex flex-col gap-3">
                    {group && (
                        <h3 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                            {group}
                        </h3>
                    )}
                    {fields.map(({ key, schema }) => (
                        <SchemaField
                            key={key}
                            schema={schema}
                            value={value[key]}
                            onChange={(next) => onChange({ ...value, [key]: next })}
                            path={`meta.${key}`}
                            issues={issues}
                        />
                    ))}
                </div>
            ))}
        </div>
    )
}
