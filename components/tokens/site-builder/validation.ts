// ============================================================================
// Build step 8 of site-platform/docs/Form spec.md — client-side issues.
//
// validateAgainstManifest() is the single source of truth (site-platform's own
// publish-time gate); this file only shapes a sparse draft enough to call it
// safely and translates its section issue paths into something the form's
// per-section components can match against reliably. It is NOT a second
// validator — no rule here duplicates or overrides what that function decides.
// ============================================================================

import { SiteContent, ValidationIssue } from '@/site-platform/schema'

/**
 * `validateAgainstManifest` dereferences `content.sections` (array),
 * `content.hero` (object) and `content.social` (array) without an optional
 * guard — correct for a schema-parsed SiteContent, but a draft mid-edit can
 * lack any of them (e.g. before the first section is ever added). Filling in
 * only the shapes it actually touches, nothing else, keeps this a defaulting
 * step rather than a parallel schema.
 */
export function normalizeForValidation(content: Record<string, unknown> | undefined): SiteContent {
    return {
        schemaVersion: 1,
        meta: (content?.meta ?? {}) as SiteContent['meta'],
        brand: (content?.brand ?? {}) as SiteContent['brand'],
        hero: (content?.hero ?? {}) as SiteContent['hero'],
        sections: Array.isArray(content?.sections) ? content.sections as SiteContent['sections'] : [],
        social: Array.isArray(content?.social) ? content.social as SiteContent['social'] : [],
        modules: content?.modules as SiteContent['modules'],
        footer: (content?.footer ?? {}) as SiteContent['footer'],
    }
}

const SECTION_PATH = /^sections\[(\d+)\]/

/**
 * `validateAgainstManifest` numbers sections by position in
 * `content.sections.filter(s => s.enabled)` — the same array it validates
 * against, not `section.id`. That index is meaningless once the form sorts by
 * `order` or a section gets toggled, so this remaps `sections[N]...` to
 * `sections[<id>]...` using the identical filter, before any component tries
 * to match a field's path against it. The manifest-facing path string itself
 * is never changed — only this internal copy used for UI lookups.
 */
export function remapSectionIssuePaths(content: SiteContent, issues: ValidationIssue[]): ValidationIssue[] {
    const active = content.sections.filter((s) => s.enabled)

    return issues.map((issue) => {
        const match = issue.path.match(SECTION_PATH)
        if (!match) return issue

        const id = active[Number(match[1])]?.id
        if (!id) return issue

        return { ...issue, path: issue.path.replace(SECTION_PATH, `sections[${id}]`) }
    })
}

export function issuesForPath(issues: ValidationIssue[], path: string): ValidationIssue[] {
    return issues.filter((i) => i.path === path)
}

export function firstError(issues: ValidationIssue[]): ValidationIssue | undefined {
    return issues.find((i) => i.severity === 'error')
}

/** DOM id for the field a given issue path renders as — shared by SchemaField (write) and the header's jump-to-error (read). */
export function fieldElementId(path: string): string {
    return `field-${path}`
}
