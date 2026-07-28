'use client'

import { useEffect, useState } from 'react'
import LaunchSelectCard from '@/components/tokens/launch/launch-select-card'
import {
    Tooltip,
    TooltipContent,
    TooltipProvider,
    TooltipTrigger,
} from '@/components/ui/tooltip'
import { Copy } from 'lucide-react'
import { SiteTemplate } from '@/lib/types/site-template'

type Props = {
    selectedTemplate: SiteTemplate | null
    onSelect: (template: SiteTemplate) => void
}

export default function SiteTemplateSelect({ selectedTemplate, onSelect }: Props) {
    const [templates, setTemplates] = useState<SiteTemplate[]>([])
    const [loading, setLoading] = useState(true)
    const [copied, setCopied] = useState(false)

    useEffect(() => {
        fetch('/api/site-templates?active=true')
            .then((r) => {
                if (!r.ok) {
                    r.json().then(body => console.error('[site-templates] API error', r.status, body))
                    return
                }
                return r.json()
            })
            .then((data) => {
                if (!data) return
                setTemplates(data.templates ?? [])
                setLoading(false)
            })
            .catch((err) => {
                console.error('SiteTemplateSelect fetch error:', err)
                setLoading(false)
            })
    }, [])

    function copyMediaSpecs() {
        if (!selectedTemplate?.media_specs) return
        navigator.clipboard.writeText(JSON.stringify(selectedTemplate.media_specs, null, 2))
        setCopied(true)
        setTimeout(() => setCopied(false), 2000)
    }

    if (loading) {
        return <p className="text-sm text-muted-foreground py-4">Loading templates…</p>
    }

    if (templates.length === 0) {
        return <p className="text-sm text-muted-foreground py-4">No site templates available.</p>
    }

    const items = selectedTemplate?.media_specs?.items ?? []

    return (
        <div className="w-full flex flex-col gap-4">
            <div className="flex flex-row gap-4 w-full">
                {templates.map((template) => (
                    <button
                        key={template.id}
                        className={[
                            'flex-1 flex flex-col h-full text-left rounded-lg transition-all',
                            'active:scale-[0.99]',
                            selectedTemplate?.id === template.id
                                ? 'ring-2 ring-blue-500'
                                : 'hover:ring-2 hover:ring-blue-400/50',
                        ].join(' ')}
                        onClick={() => onSelect(template)}
                    >
                        <LaunchSelectCard
                            title={template.name}
                            description={template.description ?? ''}
                            isSelected={selectedTemplate?.id === template.id}
                        />
                    </button>
                ))}
            </div>

            <div className="flex flex-col gap-2 w-full">
                <h3 className="text-sm font-medium text-center">Template Media Specs</h3>

                {!selectedTemplate ? (
                    <p className="text-sm text-muted-foreground">Select a template to view its media specs.</p>
                ) : (
                    <TooltipProvider>
                        <div className="w-full rounded-lg border bg-muted/40 p-4">
                            <div className="flex justify-start mb-3">
                                <Tooltip open={copied ? true : undefined}>
                                    <TooltipTrigger asChild>
                                        <button
                                            type="button"
                                            onClick={copyMediaSpecs}
                                            disabled={items.length === 0}
                                            className="flex items-center gap-1.5 rounded-md border bg-background px-2.5 py-1.5 text-xs font-medium text-foreground shadow-sm hover:bg-muted transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                                            aria-label="Copy media specs"
                                        >
                                            <Copy className="size-3.5" />
                                            Copy
                                        </button>
                                    </TooltipTrigger>
                                    <TooltipContent side="top">
                                        {copied ? 'Copied!' : 'Copy to clipboard'}
                                    </TooltipContent>
                                </Tooltip>
                            </div>

                            {items.length === 0 ? (
                                <p className="text-sm text-muted-foreground">No media specs defined for this template.</p>
                            ) : (
                                <div className="flex flex-col divide-y divide-border">
                                    {items.map((item) => (
                                        <div key={item.id} className="flex items-center gap-4 py-2 text-sm first:pt-0 last:pb-0">
                                            <span className="w-32 shrink-0 truncate font-medium">{item.name}</span>
                                            <span className="w-14 shrink-0 text-xs uppercase text-muted-foreground">{item.type}</span>
                                            <span className="w-14 shrink-0 text-xs uppercase text-muted-foreground">{item.filetype}</span>
                                            <span className="w-20 shrink-0 text-xs font-mono text-muted-foreground">
                                                {item.width && item.height ? `${item.width}×${item.height}` : '—'}
                                            </span>
                                            <span className="flex-1 min-w-0 truncate text-xs text-muted-foreground">
                                                {item.description || '—'}
                                            </span>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    </TooltipProvider>
                )}
            </div>
        </div>
    )
}
