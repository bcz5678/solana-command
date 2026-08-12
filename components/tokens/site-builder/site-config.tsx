'use client'

// ============================================================================
// Harness for site-platform/docs/Form spec.md > Build order, steps 1-11.
//
// Step 1: useSiteDraft round trip (load, edit, debounced autosave, save
// status) — proven with a raw-JSON textarea, nothing more.
// Step 2: TemplatePicker, shown only before a template is chosen. Selecting
// seeds an empty definition and drops back into the same textarea harness.
// Step 3: MetaFields, driven entirely by SchemaField off SiteMetaSchema's
// registered field() metadata. The raw textarea stays alongside it as a
// second view onto the same definition — a quick way to see that editing a
// generated field and editing the JSON directly land in the same place.
// Step 4: HeroEditor, same pattern, plus the CTA sub-form for hero.ctas.
// Step 5: MediaField inside HeroEditor, for backgroundImage — needs the
// template's manifest (for aspectFor) alongside siteId, so both are loaded
// here and threaded down.
// Step 6: SectionList for content.sections, same siteId/manifest threading.
// Step 7: PreviewPane, debounced 300ms behind autosave's 800ms. Placed above
// the raw textarea so it's visible without scrolling past every field editor
// — "this is where it becomes usable" per the build order.
// Step 8: client-side validation. validateAgainstManifest() runs on every
// content/manifest change; BuilderHeader shows the error/warning count and
// jumps to (opening, if it's inside a section) the first error's field.
// Step 9: DesignTab, shown only when showsDesignTab(manifest) — a slotted
// template's fixed look means both its token sources are empty.
// Step 10: Publish (in BuilderHeader) + BuildStatus over Realtime. A failed
// build's validation_issues merge into the same `issues` array everything
// else reads, so "map back to fields" (Form spec.md > Behaviour > Publish
// step 6) falls out of infrastructure build step 8 already built, rather than
// needing a second issue-marking path.
// Step 11: ModulesTab (manifest.supportsModules only) and SettingsTab. Two
// required module fields (countdown.targetIso, mailingList.actionUrl) got
// field() metadata added — same reasoning as step 9's semantic-token gap:
// required with no default, so silently unannotated meant unreachable, not
// just unfinished. noindex/locale needed no new component — see settings-tab.tsx.
// ============================================================================

import { useEffect, useMemo, useState } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { useSiteDraft, emptySiteDefinition, useBuildStatus, publishSite, PublishError } from '@/lib/sites/client'
import { useTemplateManifest, showsDesignTab } from '@/lib/templates/client'
import { TemplateListEntry } from '@/lib/templates/types'
import { BuildRow } from '@/lib/sites/types'
import { SiteDefinition, validateAgainstManifest } from '@/site-platform/schema'
import TemplatePicker from './template-picker'
import MetaFields from './meta-fields'
import HeroEditor from './hero-editor'
import SectionList from './section-list'
import PreviewPane from './preview-pane'
import BuilderHeader from './builder-header'
import DesignTab from './design-tab'
import BuildStatus from './build-status'
import ModulesTab from './modules-tab'
import SettingsTab from './settings-tab'
import { normalizeForValidation, remapSectionIssuePaths, firstError, fieldElementId } from './validation'

type Props = {
    siteId: string
}

export default function SiteConfig({ siteId }: Props) {
    const { definition, templateId, status, error, savedAt, domain, provisioningStatus, setDefinition, selectTemplate } =
        useSiteDraft(siteId || null)

    const build = useBuildStatus(siteId || null)
    const [note, setNote] = useState('')
    const [publishing, setPublishing] = useState(false)
    const [publishMessage, setPublishMessage] = useState<string | null>(null)
    const [publishError, setPublishError] = useState<string | null>(null)

    // Local-only: lets "Change template" reopen the picker without touching the
    // draft until a new template is actually picked.
    const [pickingTemplate, setPickingTemplate] = useState(false)

    // Lifted out of SectionList so "jump to first error" can open the section
    // an error lives in before scrolling to it.
    const [openSectionId, setOpenSectionId] = useState<string | null>(null)

    const [rawText, setRawText] = useState('')
    const [parseError, setParseError] = useState<string | null>(null)

    // Sync the textarea from the loaded/saved definition — but only when it
    // isn't mid-edit, so a server round trip never clobbers what's being typed.
    useEffect(() => {
        if (definition !== null) {
            setRawText(JSON.stringify(definition, null, 2))
            setParseError(null)
        }
    }, [definition])

    function onRawTextChange(value: string) {
        setRawText(value)
        try {
            const parsed = JSON.parse(value)
            setParseError(null)
            setDefinition(parsed)
        } catch (err) {
            setParseError(err instanceof Error ? err.message : String(err))
        }
    }

    function onTemplateSelect(template: TemplateListEntry) {
        selectTemplate(template.id, emptySiteDefinition(template.id, template.version))
        setPickingTemplate(false)
    }

    function onContentFieldChange(field: string, next: unknown) {
        if (!definition) return
        setDefinition({
            ...definition,
            content: { ...(definition.content as Record<string, unknown> | undefined ?? {}), [field]: next },
        } as Partial<SiteDefinition>)
    }

    function onThemeChange(next: Record<string, unknown>) {
        if (!definition) return
        setDefinition({ ...definition, theme: next } as Partial<SiteDefinition>)
    }

    const content = definition?.content as Record<string, unknown> | undefined

    const { manifest } = useTemplateManifest(templateId ?? undefined, definition?.templateVersion)

    const normalizedContent = useMemo(() => normalizeForValidation(content), [content])
    const issues = useMemo(() => {
        const clientIssues = manifest
            ? remapSectionIssuePaths(normalizedContent, validateAgainstManifest(normalizedContent, manifest))
            : []

        // A failed build's validation_issues describe the definition as it was
        // AT PUBLISH TIME, not necessarily the current draft — an approximation
        // that degrades gracefully as edits diverge, since remapping still keys
        // sections by id. Still worth surfacing: it's the one issue source the
        // client-side check above can never reproduce (a strict Zod parse
        // failure, not a content-completeness gap).
        if (build?.status !== 'failed') return clientIssues

        const raw = build.validation_issues
            ?? (build.error_detail?.validation_issues as BuildRow['validation_issues'] | undefined)
            ?? [];
        return [...clientIssues, ...remapSectionIssuePaths(normalizedContent, raw)]
    }, [normalizedContent, manifest, build])
    const errorCount = issues.filter((i) => i.severity === 'error').length
    const warningCount = issues.length - errorCount

    function onJumpToFirstError() {
        const issue = firstError(issues)
        if (!issue) return

        const sectionMatch = issue.path.match(/^sections\[([^\]]+)\]/)
        if (sectionMatch) setOpenSectionId(sectionMatch[1])

        // Radix only mounts CollapsibleContent once `open` is true — give a
        // newly-opened section a moment to render before scrolling to it.
        setTimeout(() => {
            document.getElementById(fieldElementId(issue.path))?.scrollIntoView({ behavior: 'smooth', block: 'center' })
        }, sectionMatch ? 50 : 0)
    }

    async function onPublish() {
        if (!definition || !templateId) return

        // Form spec.md > Behaviour > Publish, step 1: validate and jump before
        // ever sending the request — no point round-tripping to a 422 the
        // client already knows about.
        if (errorCount > 0) {
            onJumpToFirstError()
            return
        }

        setPublishing(true)
        setPublishError(null)
        setPublishMessage(null)

        try {
            const result = await publishSite(siteId, {
                definition,
                templateId,
                templateVersion: definition.templateVersion,
                note: note.trim() || undefined,
            })

            if (result.status === 'unchanged') {
                setPublishMessage(result.message ?? 'No changes to publish.')
            }
            // "queued" needs no local message — BuildStatus picks up the new
            // row over the same Realtime subscription already running.
        } catch (err) {
            if (err instanceof PublishError) {
                setPublishError(err.detail ? `${err.message} — ${err.detail}` : err.message)
            } else {
                setPublishError(err instanceof Error ? err.message : String(err))
            }
        } finally {
            setPublishing(false)
        }
    }

    const showPicker = definition !== null && (pickingTemplate || !templateId)

    return (
        <div className="w-full flex flex-col gap-4">
            <Card>
                <CardContent className="flex flex-col gap-4 pt-2">
                    {/* Loading and error are deliberately outside the definition
                        gate below — a failed fetch leaves definition null
                        forever, and this is the only place that would ever
                        surface why. */}
                    {status === 'loading' && definition === null && (
                        <p className="text-sm text-muted-foreground">Loading site…</p>
                    )}

                    {error && (
                        <p className="text-xs text-destructive">{error}</p>
                    )}

                    {definition !== null && (
                        <>
                            <BuilderHeader
                                status={status}
                                savedAt={savedAt}
                                errorCount={errorCount}
                                warningCount={warningCount}
                                onJumpToFirstError={onJumpToFirstError}
                                note={note}
                                onNoteChange={setNote}
                                publishing={publishing}
                                onPublish={onPublish}
                            />
                            {parseError && (
                                <span className="text-xs text-destructive">Invalid JSON — not saving</span>
                            )}

                            {publishMessage && (
                                <p className="text-xs text-muted-foreground">{publishMessage}</p>
                            )}
                            {publishError && (
                                <p className="text-xs text-destructive">{publishError}</p>
                            )}

                            <BuildStatus build={build} domain={domain} />
                        </>
                    )}
                </CardContent>
            </Card>

            {showPicker && (
                <TemplatePicker onSelect={onTemplateSelect} />
            )}

            {!showPicker && definition !== null && (
                <Card>
                    <CardContent className="flex flex-col gap-4 pt-2">
                        <div className="flex items-center justify-between">
                            <span className="text-sm">
                                Template: <span className="font-mono">{templateId}</span>
                            </span>
                            <Button variant="outline" size="sm" onClick={() => setPickingTemplate(true)}>
                                Change template
                            </Button>
                        </div>

                        <div className="flex flex-col gap-1.5">
                            <label className="text-xs font-medium text-muted-foreground">Preview</label>
                            <PreviewPane siteId={siteId} definition={definition} />
                        </div>

                        <div className="flex flex-col gap-1.5">
                            <label className="text-xs font-medium text-muted-foreground">Meta</label>
                            <MetaFields
                                value={content?.meta as Record<string, unknown> ?? {}}
                                onChange={(next) => onContentFieldChange('meta', next)}
                                issues={issues}
                            />
                        </div>

                        <div className="flex flex-col gap-1.5">
                            <label className="text-xs font-medium text-muted-foreground">Hero</label>
                            <HeroEditor
                                siteId={siteId}
                                manifest={manifest}
                                value={content?.hero as Record<string, unknown> ?? {}}
                                onChange={(next) => onContentFieldChange('hero', next)}
                                issues={issues}
                            />
                        </div>

                        {manifest && showsDesignTab(manifest) && (
                            <div className="flex flex-col gap-1.5">
                                <label className="text-xs font-medium text-muted-foreground">Design</label>
                                <DesignTab
                                    manifest={manifest}
                                    value={definition.theme as Record<string, unknown> | undefined}
                                    onChange={onThemeChange}
                                />
                            </div>
                        )}

                        {manifest && (
                            <div className="flex flex-col gap-1.5">
                                <label className="text-xs font-medium text-muted-foreground">Modules</label>
                                <ModulesTab
                                    manifest={manifest}
                                    value={content?.modules as Record<string, unknown> | undefined}
                                    onChange={(next) => onContentFieldChange('modules', next)}
                                    issues={issues}
                                />
                            </div>
                        )}

                        <div className="flex flex-col gap-1.5">
                            <label className="text-xs font-medium text-muted-foreground">Settings</label>
                            <SettingsTab domain={domain} provisioningStatus={provisioningStatus} />
                        </div>

                        <div className="flex flex-col gap-1.5">
                            <label className="text-xs font-medium text-muted-foreground">Sections</label>
                            <SectionList
                                siteId={siteId}
                                manifest={manifest}
                                value={Array.isArray(content?.sections) ? content.sections as Record<string, unknown>[] : []}
                                onChange={(next) => onContentFieldChange('sections', next)}
                                issues={issues}
                                openId={openSectionId}
                                onOpenChange={setOpenSectionId}
                            />
                        </div>

                        <div className="flex flex-col gap-1.5">
                            <label className="text-xs font-medium text-muted-foreground">
                                Draft definition (raw JSON)
                            </label>
                            <textarea
                                value={rawText}
                                onChange={(e) => onRawTextChange(e.target.value)}
                                spellCheck={false}
                                className="h-96 w-full resize-y rounded-md border border-input bg-transparent p-3 font-mono text-xs"
                            />
                        </div>
                    </CardContent>
                </Card>
            )}
        </div>
    )
}
