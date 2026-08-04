import { ImageOff } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { TemplateListEntry } from '@/lib/templates/types'

type Props = {
    template: TemplateListEntry
    isSelected?: boolean
}

export default function TemplateListCard({ template, isSelected }: Props) {
    return (
        <Card className={[
            'h-full transition-colors',
            isSelected
                ? 'border-blue-500 bg-blue-500/5'
                : 'hover:border-blue-400/60',
        ].join(' ')}>
            <CardHeader className="flex flex-row items-center gap-3">
                {template.previewImage ? (
                    <img
                        src={template.previewImage}
                        alt={template.name}
                        className="size-12 shrink-0 rounded-md object-cover ring-1 ring-foreground/10"
                    />
                ) : (
                    <div className="flex size-12 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground ring-1 ring-foreground/10">
                        <ImageOff className="size-4" />
                    </div>
                )}

                <div className="flex min-w-0 flex-col gap-1">
                    <CardTitle>{template.name}</CardTitle>
                    <CardDescription className="truncate">{template.description}</CardDescription>
                </div>
            </CardHeader>

            <CardContent className="flex items-center gap-1.5">
                <Badge variant="outline" className="capitalize">{template.kind}</Badge>
                <Badge variant="secondary">v{template.version}</Badge>
            </CardContent>
        </Card>
    );
}
