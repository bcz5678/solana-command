'use client'

// ============================================================================
// The `prose` type-specific part of SectionEditor — the one type step 6's
// "SectionEditor per-type sub-form" is built against.
//
// `body` needs no bespoke handling here: it has `field()` metadata with
// `widget: "repeater"`, so it already renders through SchemaField (same
// generic string-array repeater as hero.body). `cta` and `media` are nested
// objects with no top-level metadata, so — like CtaEditor and MediaField
// elsewhere — they get bespoke handling instead of a SchemaField case.
// ============================================================================

import { ImageAsset, SiteCtaSchema, TemplateManifest } from '@/site-platform/schema'
import { Button } from '@/components/ui/button'
import SchemaField, { collectFields } from './schema-field'
import MediaField from './media-field'

type Props = {
    siteId: string
    manifest: TemplateManifest | null
    value: Record<string, unknown>
    onChange: (next: Record<string, unknown>) => void
}

const EMPTY_CTA = { label: '', href: '', external: false, variant: 'primary' }

export default function ProseSectionFields({ siteId, manifest, value, onChange }: Props) {
    const cta = value.cta as Record<string, unknown> | undefined
    const ctaFields = cta ? [...collectFields(SiteCtaSchema.shape, cta).values()].flat() : []

    return (
        <>
            <div className="flex flex-col gap-1.5">
                <h4 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                    Inline image
                </h4>
                <MediaField
                    siteId={siteId}
                    slot="card"
                    manifest={manifest}
                    value={value.media as ImageAsset | undefined}
                    onChange={(next) => onChange({ ...value, media: next })}
                />
            </div>

            <div className="flex flex-col gap-1.5">
                <h4 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                    Button
                </h4>
                {!cta ? (
                    <Button
                        type="button" variant="outline" size="sm" className="w-fit"
                        onClick={() => onChange({ ...value, cta: { ...EMPTY_CTA } })}
                    >
                        Add button
                    </Button>
                ) : (
                    <div className="flex flex-col gap-3">
                        {ctaFields.map(({ key, schema }) => (
                            <SchemaField
                                key={key}
                                schema={schema}
                                value={cta[key]}
                                onChange={(next) => onChange({ ...value, cta: { ...cta, [key]: next } })}
                            />
                        ))}
                        <Button
                            type="button" variant="ghost" size="sm" className="w-fit"
                            onClick={() => onChange({ ...value, cta: undefined })}
                        >
                            Remove button
                        </Button>
                    </div>
                )}
            </div>
        </>
    )
}
