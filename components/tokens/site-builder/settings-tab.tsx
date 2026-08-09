'use client'

// ============================================================================
// Build step 11's SettingsTab — domain, noindex, locale.
//
// noindex and locale needed no new component: they're plain SiteMetaSchema
// fields, so giving them field() metadata (group: "Settings") makes them
// appear inside MetaFields' own generic group rendering automatically — that
// component already iterates every annotated field in the schema. Building a
// second SchemaField call site for the same two fields would just render them
// twice, bound to the same value, for no reason.
//
// Domain is the one setting that ISN'T part of `content` — it's a site-level
// column (private.sites.domain), loaded read-only via useSiteDraft. No route
// in Form spec.md's API contracts mutates it, so this is display-only.
// ============================================================================

import { Badge } from '@/components/ui/badge'

type Props = {
    domain: string | null
    provisioningStatus: string | null
}

export default function SettingsTab({ domain, provisioningStatus }: Props) {
    return (
        <div className="flex flex-col gap-1.5">
            <div className="flex items-center gap-2">
                <span className="font-mono text-sm">{domain ?? '—'}</span>
                {provisioningStatus && <Badge variant="outline">{provisioningStatus}</Badge>}
            </div>
            <p className="text-xs text-muted-foreground">
                Set when the site is created — not editable from this form. Noindex and
                locale are in the Meta section&apos;s Settings group.
            </p>
        </div>
    )
}
