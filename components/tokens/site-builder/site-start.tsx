'use client'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { SiteBuilderMode } from './types'

type Props = {
    mode: SiteBuilderMode | null
    onSelect: (mode: SiteBuilderMode) => void
}

export default function SiteStart({ mode, onSelect }: Props) {
    return (
        <div className="w-full flex flex-col gap-4">
            <div className="flex flex-row gap-4 w-full">
                <button
                    className={[
                        'flex-1 text-left rounded-lg transition-all active:scale-[0.99]',
                        mode === 'create'
                            ? 'ring-2 ring-blue-500'
                            : 'hover:ring-2 hover:ring-blue-400/50',
                    ].join(' ')}
                    onClick={() => onSelect('create')}
                >
                    <Card className={mode === 'create' ? 'border-blue-500 bg-blue-500/5' : 'hover:border-blue-400/60'}>
                        <CardHeader>
                            <CardTitle>Create New Site</CardTitle>
                        </CardHeader>
                        <CardContent>
                            <p className="text-sm text-muted-foreground">Start from scratch — pick a token, a template, and a domain to launch a brand new site.</p>
                        </CardContent>
                    </Card>
                </button>
                <button
                    className={[
                        'flex-1 text-left rounded-lg transition-all active:scale-[0.99]',
                        mode === 'edit'
                            ? 'ring-2 ring-blue-500'
                            : 'hover:ring-2 hover:ring-blue-400/50',
                    ].join(' ')}
                    onClick={() => onSelect('edit')}
                >
                    <Card className={mode === 'edit' ? 'border-blue-500 bg-blue-500/5' : 'hover:border-blue-400/60'}>
                        <CardHeader>
                            <CardTitle>Edit Existing Site</CardTitle>
                        </CardHeader>
                        <CardContent>
                            <p className="text-sm text-muted-foreground">Pick a site you&apos;ve already set up and carry its settings through the wizard to change them.</p>
                        </CardContent>
                    </Card>
                </button>
            </div>
        </div>
    )
}
