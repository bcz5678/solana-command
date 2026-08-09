'use client'

// ============================================================================
// Build step 6 of site-platform/docs/Form spec.md — reorder, add/remove,
// enable, manifest constraints. SectionEditor (per-type sub-form) renders
// inside each row's Collapsible.
//
// Reorder writes `order`, never array position — array index is a rendering
// detail, not identity (CLAUDE.md > Section identity vs sequence). Rows are
// keyed on `section.id` for the same reason.
//
// Build step 8: `issues` is expected pre-remapped by the caller (see
// validation.ts > remapSectionIssuePaths) so every path here already reads
// `sections[<id>]`, never `sections[<array index>]`. `openId` is lifted to the
// caller so the header's "jump to first error" can open the right row before
// scrolling to it.
// ============================================================================

import { Plus, Trash2, ChevronUp, ChevronDown, ChevronRight } from 'lucide-react'
import { SectionType, TemplateManifest, ValidationIssue } from '@/site-platform/schema'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from '@/components/ui/collapsible'
import SectionEditor from './section-editor'
import { createSection } from './section-defaults'
import { fieldElementId } from './validation'

type Section = Record<string, unknown>

type Props = {
    siteId: string
    manifest: TemplateManifest | null
    value: Section[]
    onChange: (next: Section[]) => void
    issues?: ValidationIssue[]
    openId: string | null
    onOpenChange: (id: string | null) => void
}

export default function SectionList({ siteId, manifest, value, onChange, issues = [], openId, onOpenChange }: Props) {
    const sections = [...value].sort((a, b) => (a.order as number) - (b.order as number))
    const boundsIssue = issues.find((i) => i.path === 'sections')
    // Only ENABLED sections count against the manifest's min/max — a disabled
    // section is preserved content, not a rendered one, so it neither helps
    // reach `min` nor counts toward `max`. Mirrors validateAgainstManifest's
    // own `active = sections.filter(s => s.enabled)`.
    const enabledCount = sections.filter((s) => s.enabled !== false).length
    const supportedTypes = manifest?.supportedSectionTypes ?? []
    const min = manifest?.sectionCount.min ?? 0
    const max = manifest?.sectionCount.max ?? Infinity

    function updateSection(id: string, next: Section) {
        onChange(value.map((s) => (s.id === id ? next : s)))
    }

    function addSection(type: SectionType) {
        const nextOrder = sections.length
            ? Math.max(...sections.map((s) => s.order as number)) + 1
            : 0
        const created = createSection(type, nextOrder)
        onChange([...value, created])
        onOpenChange(created.id as string)
    }

    function removeSection(id: string) {
        onChange(value.filter((s) => s.id !== id))
    }

    function moveSection(id: string, direction: -1 | 1) {
        const index = sections.findIndex((s) => s.id === id)
        const targetIndex = index + direction
        if (targetIndex < 0 || targetIndex >= sections.length) return

        const a = sections[index]
        const b = sections[targetIndex]
        onChange(value.map((s) => {
            if (s.id === a.id) return { ...s, order: b.order }
            if (s.id === b.id) return { ...s, order: a.order }
            return s
        }))
    }

    return (
        <div className="flex flex-col gap-2">
            {boundsIssue && (
                <p id={fieldElementId('sections')} className="text-xs text-destructive">
                    {boundsIssue.message}
                </p>
            )}

            {sections.map((section, i) => {
                const id = section.id as string
                const sectionPath = `sections[${id}]`
                const enabled = section.enabled !== false
                // A section that's already disabled doesn't count toward
                // enabledCount, so removing it can't push the template under
                // `min` — only an enabled section at the floor is protected.
                const disableRemove = enabled && enabledCount <= min
                const sectionIssues = issues.filter((iss) => iss.path.startsWith(sectionPath))
                const hasError = sectionIssues.some((iss) => iss.severity === 'error')

                return (
                    <Card key={id}>
                        <Collapsible open={openId === id} onOpenChange={(open) => onOpenChange(open ? id : null)}>
                            <CardContent className="flex items-center gap-2 pt-2">
                                <Checkbox
                                    checked={enabled}
                                    onCheckedChange={(checked) => updateSection(id, { ...section, enabled: checked === true })}
                                />

                                <CollapsibleTrigger asChild>
                                    <button type="button" className="group flex flex-1 items-center gap-2 text-left">
                                        <ChevronRight className="size-3.5 shrink-0 transition-transform group-data-[state=open]:rotate-90" />
                                        <span className="text-sm font-medium">
                                            {(section.title as string) || (section.navLabel as string) || 'Untitled section'}
                                        </span>
                                        <span className="text-xs text-muted-foreground">({section.type as string})</span>
                                        {sectionIssues.length > 0 && (
                                            <span className={hasError ? 'size-1.5 rounded-full bg-destructive' : 'size-1.5 rounded-full bg-amber-500'} />
                                        )}
                                    </button>
                                </CollapsibleTrigger>

                                <div className="flex flex-col gap-0.5">
                                    <Button
                                        type="button" variant="ghost" size="icon-xs"
                                        disabled={i === 0}
                                        onClick={() => moveSection(id, -1)}
                                    >
                                        <ChevronUp />
                                    </Button>
                                    <Button
                                        type="button" variant="ghost" size="icon-xs"
                                        disabled={i === sections.length - 1}
                                        onClick={() => moveSection(id, 1)}
                                    >
                                        <ChevronDown />
                                    </Button>
                                </div>
                                <Button
                                    type="button" variant="ghost" size="icon-xs"
                                    disabled={disableRemove}
                                    onClick={() => removeSection(id)}
                                >
                                    <Trash2 />
                                </Button>
                            </CardContent>

                            <CollapsibleContent>
                                <CardContent className="pt-0">
                                    <SectionEditor
                                        siteId={siteId}
                                        manifest={manifest}
                                        section={section}
                                        onChange={(next) => updateSection(id, next)}
                                        sectionPath={sectionPath}
                                        issues={issues}
                                    />
                                </CardContent>
                            </CollapsibleContent>
                        </Collapsible>
                    </Card>
                )
            })}

            {supportedTypes.length > 0 && (
                <div className="flex flex-wrap items-center gap-1.5">
                    <span className="text-xs text-muted-foreground">Add section:</span>
                    {supportedTypes.map((type) => (
                        <Button
                            key={type} type="button" variant="outline" size="sm"
                            disabled={enabledCount >= max}
                            onClick={() => addSection(type)}
                        >
                            <Plus /> {type}
                        </Button>
                    ))}
                </div>
            )}
        </div>
    )
}
