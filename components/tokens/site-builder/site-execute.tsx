'use client'

import { useState } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { DomainMode, SiteBuilderConfig } from './types'

type Props = {
    config: SiteBuilderConfig
}

export default function SiteExecute({ config }: Props) {
    const [status, setStatus] = useState<'idle' | 'deploying' | 'done'>('idle')

    function onDeploy() {
        setStatus('deploying')
        // TODO: wire up to site deployment API
        setTimeout(() => setStatus('done'), 1200)
    }

    return (
        <div className="w-full flex flex-col gap-4">
            <Card>
                <CardContent className="flex flex-col gap-3 pt-2 text-sm">
                    <div className="grid grid-cols-2 gap-x-8 gap-y-3 sm:grid-cols-3">
                        <div>
                            <p className="text-xs text-muted-foreground mb-0.5">Token</p>
                            <p>{config.token?.token_symbol ?? '—'}</p>
                        </div>
                        <div>
                            <p className="text-xs text-muted-foreground mb-0.5">Template</p>
                            <p>{config.template}</p>
                        </div>
                        <div>
                            <p className="text-xs text-muted-foreground mb-0.5">Domain</p>
                            <p className="font-mono">{config.resolvedDomain || '—'}</p>
                        </div>
                        <div>
                            <p className="text-xs text-muted-foreground mb-0.5">Site Title</p>
                            <p>{config.siteTitle || config.token?.token_name || '—'}</p>
                        </div>
                        <div>
                            <p className="text-xs text-muted-foreground mb-0.5">Tagline</p>
                            <p>{config.tagline || '—'}</p>
                        </div>
                        <div>
                            <p className="text-xs text-muted-foreground mb-0.5">Domain Mode</p>
                            <p>{config.domainMode === DomainMode.custom ? 'Custom' : 'Subdomain'}</p>
                        </div>
                    </div>
                </CardContent>
            </Card>

            <div className="flex items-center gap-3">
                <Button onClick={onDeploy} disabled={status !== 'idle'}>
                    {status === 'idle' && 'Deploy Site'}
                    {status === 'deploying' && 'Deploying…'}
                    {status === 'done' && 'Deployed'}
                </Button>
                {status === 'done' && (
                    <span className="text-sm text-muted-foreground">
                        Site is live at <span className="font-mono text-foreground">{config.resolvedDomain}</span>
                    </span>
                )}
            </div>
        </div>
    )
}
