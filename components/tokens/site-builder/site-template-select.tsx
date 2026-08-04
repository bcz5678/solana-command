'use client'

import { useEffect, useState } from 'react'
import TemplateListCard from '@/components/tokens/site-builder/template-list-card'
import { fetchTemplates } from '@/lib/templates/client'
import { TemplateListEntry } from '@/lib/templates/types'

type Props = {
    selectedTemplate: TemplateListEntry | null
    onSelect: (template: TemplateListEntry) => void
    /** Best-effort template name to auto-select once templates load — used when carrying over an existing site's config. */
    initialTemplateName?: string
}

export default function SiteTemplateSelect({ selectedTemplate, onSelect, initialTemplateName }: Props) {
    const [templates, setTemplates] = useState<TemplateListEntry[]>([])
    const [loading, setLoading] = useState(true)

    useEffect(() => {
        fetchTemplates()
            .then((fetched) => {
                setTemplates(fetched)
                setLoading(false)

                if (!selectedTemplate && initialTemplateName) {
                    const match = fetched.find(
                        (t) => t.name.toLowerCase() === initialTemplateName.toLowerCase(),
                    )
                    if (match) onSelect(match)
                }
            })
            .catch((err) => {
                console.error('SiteTemplateSelect fetch error:', err)
                setLoading(false)
            })
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])

    if (loading) {
        return <p className="text-sm text-muted-foreground py-4">Loading templates…</p>
    }

    if (templates.length === 0) {
        return <p className="text-sm text-muted-foreground py-4">No site templates available.</p>
    }

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
                        <TemplateListCard
                            template={template}
                            isSelected={selectedTemplate?.id === template.id}
                        />
                    </button>
                ))}
            </div>
        </div>
    )
}
