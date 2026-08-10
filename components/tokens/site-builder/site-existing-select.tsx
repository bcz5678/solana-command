'use client'

import { useEffect, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { fetchSites } from '@/lib/sites/client'
import { SiteRow } from '@/lib/sites/types'

type Props = {
    selectedSiteId: string | null
    onSelect: (site: SiteRow) => void
}

function statusBadge(site: SiteRow): { label: string; variant: 'default' | 'outline' | 'destructive' } {
    if (site.is_publishable) return { label: 'Live', variant: 'default' }
    if (site.provisioning_status) return { label: site.provisioning_status, variant: 'outline' }
    return { label: 'Draft', variant: 'outline' }
}

export default function SiteExistingSelect({ selectedSiteId, onSelect }: Props) {
    const [sites, setSites] = useState<SiteRow[]>([])
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)

    useEffect(() => {
        let cancelled = false
        setLoading(true)
        setError(null)

        fetchSites()
            .then((data) => {
                if (cancelled) return
                setSites(data)
            })
            .catch((err) => {
                if (cancelled) return
                setError(err instanceof Error ? err.message : 'Failed to load sites')
            })
            .finally(() => {
                if (!cancelled) setLoading(false)
            })

        return () => {
            cancelled = true
        }
    }, [])

    if (loading) {
        return <p className="text-sm text-muted-foreground">Loading sites…</p>
    }

    if (error) {
        return <p className="text-sm text-destructive">{error}</p>
    }

    if (sites.length === 0) {
        return <p className="text-sm text-muted-foreground">No sites yet — create one from the Get Started step.</p>
    }

    return (
        <div className="w-full flex flex-col gap-3">
            <div className="flex flex-col divide-y divide-border rounded-lg border">
                {sites.map((site) => {
                    const isSelected = selectedSiteId === site.id
                    const badge = statusBadge(site)

                    return (
                        <button
                            key={site.id}
                            onClick={() => onSelect(site)}
                            className={[
                                'flex items-center gap-4 px-4 py-3 text-left transition-colors',
                                isSelected ? 'bg-blue-500/5' : 'hover:bg-muted/50',
                            ].join(' ')}
                        >
                            <span className={[
                                'size-4 rounded-full border-2 flex items-center justify-center shrink-0',
                                isSelected ? 'border-blue-500 bg-blue-500' : 'border-muted-foreground/40',
                            ].join(' ')}>
                                {isSelected && <span className="size-1.5 rounded-full bg-white" />}
                            </span>

                            <span className="size-8 shrink-0 rounded-full bg-muted border border-border flex items-center justify-center text-xs font-bold text-muted-foreground">
                                {site.token_symbol.slice(0, 1)}
                            </span>

                            <span className="w-40 shrink-0 flex flex-col">
                                <span className="text-sm font-medium truncate">{site.name}</span>
                                <span className="text-xs text-muted-foreground font-mono">{site.token_symbol}</span>
                            </span>

                            <span className="flex-1 min-w-0 truncate text-xs font-mono text-muted-foreground">
                                {site.domain ?? '—'}
                            </span>

                            <Badge variant={badge.variant} className="shrink-0 capitalize">
                                {badge.label}
                            </Badge>
                        </button>
                    )
                })}
            </div>
        </div>
    )
}
