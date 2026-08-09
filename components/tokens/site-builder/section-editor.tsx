'use client'

// ============================================================================
// Build step 6's per-type sub-form, starting with `prose` — the rest of
// site-platform/docs/Form spec.md's Build order still applies: don't extend
// the other six types until their own step.
//
// Every concrete section schema spreads the same SectionBaseShape objects
// (navLabel, showInNav, kicker, title, overlayOpacity, backgroundColor —
// object identity preserved through the spread), so collectFields() on
// whichever type's own `.shape` already returns the common fields AND that
// type's annotated fields together, correctly grouped and ordered. No need to
// export SectionBaseShape separately or special-case "common vs per-type".
// ============================================================================

import { z } from 'zod'
import {
    SectionType, TemplateManifest, ImageAsset, ValidationIssue,
    ProseSectionSchema, StatsSectionSchema, TimelineSectionSchema,
    GallerySectionSchema, FaqSectionSchema, EmbedSectionSchema, CardsSectionSchema,
} from '@/site-platform/schema'
import SchemaField, { collectFields } from './schema-field'
import MediaField from './media-field'
import ProseSectionFields from './prose-section-fields'

const SCHEMA_BY_TYPE: Record<SectionType, z.ZodObject> = {
    prose: ProseSectionSchema,
    stats: StatsSectionSchema,
    timeline: TimelineSectionSchema,
    gallery: GallerySectionSchema,
    faq: FaqSectionSchema,
    embed: EmbedSectionSchema,
    cards: CardsSectionSchema,
}

type Props = {
    siteId: string
    manifest: TemplateManifest | null
    section: Record<string, unknown>
    onChange: (next: Record<string, unknown>) => void
    /** `sections[<id>]` — pre-remapped by SectionList; see validation.ts. */
    sectionPath: string
    issues?: ValidationIssue[]
}

export default function SectionEditor({ siteId, manifest, section, onChange, sectionPath, issues }: Props) {
    const type = section.type as SectionType
    const schema = SCHEMA_BY_TYPE[type]
    const groups = collectFields(schema.shape, section)

    return (
        <div className="flex flex-col gap-5">
            {[...groups.entries()].map(([group, fields]) => (
                <div key={group || 'ungrouped'} className="flex flex-col gap-3">
                    {group && (
                        <h4 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                            {group}
                        </h4>
                    )}
                    {fields.map(({ key, schema: fieldSchema }) => (
                        <SchemaField
                            key={key}
                            schema={fieldSchema}
                            value={section[key]}
                            onChange={(next) => onChange({ ...section, [key]: next })}
                            path={`${sectionPath}.${key}`}
                            issues={issues}
                        />
                    ))}
                </div>
            ))}

            <div className="flex flex-col gap-1.5">
                <h4 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                    Background image
                </h4>
                <MediaField
                    siteId={siteId}
                    slot="section"
                    manifest={manifest}
                    value={section.backgroundImage as ImageAsset | undefined}
                    onChange={(next) => onChange({ ...section, backgroundImage: next })}
                    path={`${sectionPath}.backgroundImage`}
                    issues={issues}
                />
            </div>

            {type === 'prose' ? (
                <ProseSectionFields
                    siteId={siteId}
                    manifest={manifest}
                    value={section}
                    onChange={onChange}
                />
            ) : (
                <p className="text-xs text-muted-foreground italic">
                    &ldquo;{type}&rdquo;-specific fields aren&apos;t wired up yet — build step 6 starts with prose only.
                </p>
            )}
        </div>
    )
}
