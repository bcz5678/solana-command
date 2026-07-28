'use client'

import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { SiteBuilderConfig } from './types'

type Props = {
    config: SiteBuilderConfig
    onSiteTitleChange: (value: string) => void
    onTaglineChange: (value: string) => void
    onAccentColorChange: (value: string) => void
}

export default function SiteConfig({ config, onSiteTitleChange, onTaglineChange, onAccentColorChange }: Props) {
    return (
        <div className="w-full flex flex-col gap-4">
            <Card>
                <CardContent className="flex flex-col gap-4 pt-2">
                    <div className="flex flex-col gap-1.5">
                        <label className="text-xs font-medium text-muted-foreground">Site Title</label>
                        <Input
                            value={config.siteTitle}
                            onChange={(e) => onSiteTitleChange(e.target.value)}
                            placeholder={config.token?.token_name ?? 'My Token Site'}
                            className="max-w-96"
                        />
                    </div>

                    <div className="flex flex-col gap-1.5">
                        <label className="text-xs font-medium text-muted-foreground">Tagline</label>
                        <Input
                            value={config.tagline}
                            onChange={(e) => onTaglineChange(e.target.value)}
                            placeholder="To the moon and beyond."
                            className="max-w-96"
                        />
                    </div>

                    <div className="flex flex-col gap-1.5">
                        <label className="text-xs font-medium text-muted-foreground">Accent Color</label>
                        <div className="flex items-center gap-2">
                            <input
                                type="color"
                                value={config.accentColor}
                                onChange={(e) => onAccentColorChange(e.target.value)}
                                className="size-8 rounded-md border border-input bg-transparent p-0.5 cursor-pointer"
                            />
                            <span className="font-mono text-sm text-muted-foreground">{config.accentColor}</span>
                        </div>
                    </div>
                </CardContent>
            </Card>
        </div>
    )
}
