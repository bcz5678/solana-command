'use client'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { DomainMode, SiteBuilderConfig } from './types'

type Props = {
    config: SiteBuilderConfig
    onDomainModeChange: (mode: DomainMode) => void
    onSubdomainChange: (value: string) => void
    onCustomDomainChange: (value: string) => void
}

export default function SiteDomainSetup({ config, onDomainModeChange, onSubdomainChange, onCustomDomainChange }: Props) {
    return (
        <div className="w-full flex flex-col gap-4">
            <div className="flex flex-row gap-4 w-full">
                <button
                    className={[
                        'flex-1 text-left rounded-lg transition-all active:scale-[0.99]',
                        config.domainMode === DomainMode.subdomain
                            ? 'ring-2 ring-blue-500'
                            : 'hover:ring-2 hover:ring-blue-400/50',
                    ].join(' ')}
                    onClick={() => onDomainModeChange(DomainMode.subdomain)}
                >
                    <Card className={config.domainMode === DomainMode.subdomain ? 'border-blue-500 bg-blue-500/5' : 'hover:border-blue-400/60'}>
                        <CardHeader>
                            <CardTitle>Free Subdomain</CardTitle>
                        </CardHeader>
                        <CardContent>
                            <p className="text-sm text-muted-foreground">Get a site live instantly at yourname.solanacommand.site — no DNS setup required.</p>
                        </CardContent>
                    </Card>
                </button>
                <button
                    className={[
                        'flex-1 text-left rounded-lg transition-all active:scale-[0.99]',
                        config.domainMode === DomainMode.custom
                            ? 'ring-2 ring-blue-500'
                            : 'hover:ring-2 hover:ring-blue-400/50',
                    ].join(' ')}
                    onClick={() => onDomainModeChange(DomainMode.custom)}
                >
                    <Card className={config.domainMode === DomainMode.custom ? 'border-blue-500 bg-blue-500/5' : 'hover:border-blue-400/60'}>
                        <CardHeader>
                            <CardTitle>Custom Domain</CardTitle>
                        </CardHeader>
                        <CardContent>
                            <p className="text-sm text-muted-foreground">Point a domain you already own at your site. You&apos;ll need to update DNS records after setup.</p>
                        </CardContent>
                    </Card>
                </button>
            </div>

            <Card>
                <CardContent className="flex flex-col gap-3 pt-2">
                    {config.domainMode === DomainMode.subdomain ? (
                        <div className="flex flex-col gap-1.5">
                            <label className="text-xs font-medium text-muted-foreground">Subdomain</label>
                            <div className="flex items-center gap-2">
                                <Input
                                    value={config.subdomain}
                                    onChange={(e) => onSubdomainChange(e.target.value)}
                                    placeholder="yourtoken"
                                    className="max-w-56"
                                />
                                <span className="text-sm text-muted-foreground">.solanacommand.site</span>
                            </div>
                        </div>
                    ) : (
                        <div className="flex flex-col gap-1.5">
                            <label className="text-xs font-medium text-muted-foreground">Domain</label>
                            <Input
                                value={config.customDomain}
                                onChange={(e) => onCustomDomainChange(e.target.value)}
                                placeholder="www.yourtoken.com"
                                className="max-w-72"
                            />
                        </div>
                    )}

                    <p className="text-sm text-muted-foreground">
                        Site will be live at{' '}
                        <span className="font-mono text-foreground">
                            {config.resolvedDomain || '—'}
                        </span>
                    </p>
                </CardContent>
            </Card>
        </div>
    )
}
