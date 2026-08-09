'use client'

// ============================================================================
// Build step 4 introduced the `body[]` repeater and the CTA sub-form. Step 5
// adds MediaField for `backgroundImage` — the first (and, per the build
// order, deliberately only) field wired to media upload/focal point/crop
// preview. overlayOpacity and crossAlign still have no registered field()
// metadata, so they're correctly invisible here rather than hardcoded around.
// ============================================================================

import { ImageAsset, TemplateManifest, SiteHeroSchema, ValidationIssue } from '@/site-platform/schema'
import SchemaField, { collectFields } from './schema-field'
import CtaEditor from './cta-editor'
import MediaField from './media-field'

type Props = {
    siteId: string
    manifest: TemplateManifest | null
    value: Record<string, unknown>
    onChange: (next: Record<string, unknown>) => void
    /** Build step 8 — issues whose path starts with "hero.". */
    issues?: ValidationIssue[]
}

export default function HeroEditor({ siteId, manifest, value, onChange, issues }: Props) {
    const groups = collectFields(SiteHeroSchema.shape, value)

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
                            path={`hero.${key}`}
                            issues={issues}
                        />
                    ))}
                </div>
            ))}

            <div className="flex flex-col gap-1.5">
                <h3 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                    Background image
                </h3>
                <MediaField
                    siteId={siteId}
                    slot="hero"
                    manifest={manifest}
                    value={value.backgroundImage as ImageAsset | undefined}
                    onChange={(next) => onChange({ ...value, backgroundImage: next })}
                    path="hero.backgroundImage"
                    issues={issues}
                />
            </div>

            <div className="flex flex-col gap-1.5">
                <h3 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                    Call-to-action buttons
                </h3>
                <CtaEditor
                    value={Array.isArray(value.ctas) ? value.ctas as Record<string, unknown>[] : []}
                    onChange={(next) => onChange({ ...value, ctas: next })}
                />
            </div>
        </div>
    )
}
