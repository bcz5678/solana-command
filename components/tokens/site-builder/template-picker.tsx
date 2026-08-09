'use client'

// ============================================================================
// Build step 2 of site-platform/docs/Form spec.md — cards with preview image,
// name, and configurabilityLabel(). Rendered only before a template is chosen
// (see Form spec.md > Component tree).
// ============================================================================

import { ImageOff } from 'lucide-react'
import { Card, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { useTemplates, configurabilityLabel } from '@/lib/templates/client'
import { TemplateListEntry } from '@/lib/templates/types'

type Props = {
    onSelect: (template: TemplateListEntry) => void
}

export default function TemplatePicker({ onSelect }: Props) {
    const { templates, loading, error } = useTemplates()

    if (loading) {
        return <p className="text-sm text-muted-foreground py-4">Loading templates…</p>
    }

    if (error) {
        return <p className="text-sm text-destructive py-4">{error.message}</p>
    }

    if (templates.length === 0) {
        return <p className="text-sm text-muted-foreground py-4">No templates available.</p>
    }

    return (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
            {templates.map((template) => (
                <button
                    key={template.id}
                    onClick={() => onSelect(template)}
                    className="text-left rounded-lg transition-all active:scale-[0.99] hover:ring-2 hover:ring-blue-400/50"
                >
                    <Card>
                        {template.previewImage ? (
                            <img
                                src={template.previewImage}
                                alt={template.name}
                                className="aspect-video w-full object-cover"
                            />
                        ) : (
                            <div className="flex aspect-video w-full items-center justify-center bg-muted text-muted-foreground">
                                <ImageOff className="size-6" />
                            </div>
                        )}
                        <CardHeader className="gap-1.5">
                            <CardTitle>{template.name}</CardTitle>
                            <Badge variant="outline" className="w-fit">
                                {configurabilityLabel(template.manifest)}
                            </Badge>
                        </CardHeader>
                    </Card>
                </button>
            ))}
        </div>
    )
}
