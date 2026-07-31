'use client'

import { Badge } from '@/components/ui/badge'
import { DomainMode } from './types'

export type MockExistingSite = {
    id: string
    tokenId: string
    tokenMintPublicKey: string
    tokenName: string
    tokenSymbol: string
    logoUrl: string | null
    templateName: string
    domainMode: DomainMode
    subdomain: string
    customDomain: string
    siteTitle: string
    tagline: string
    accentColor: string
    status: 'live' | 'draft'
}

// Placeholder data — there is no `sites` backend yet, so this stands in
// for a real "list my deployed sites" API until one exists.
const mockExistingSites: MockExistingSite[] = [
    {
        id: 'mock-1',
        tokenId: 'mock-token-1',
        tokenMintPublicKey: 'DogeMK7xQZ9vB3nR8pW2sT6uY1cA4fH5jL0eN9mXpQz',
        tokenName: 'Solana Doge',
        tokenSymbol: 'SDOGE',
        logoUrl: null,
        templateName: 'Meme Landing',
        domainMode: DomainMode.subdomain,
        subdomain: 'sdoge',
        customDomain: '',
        siteTitle: 'Solana Doge',
        tagline: 'Much wow, very Solana.',
        accentColor: '#f7931a',
        status: 'live',
    },
    {
        id: 'mock-2',
        tokenId: 'mock-token-2',
        tokenMintPublicKey: 'CmdFi3nQ8xR2vB7pW9sT4uY6cA1fH0jL5eN3mXpQzR8',
        tokenName: 'Command Finance',
        tokenSymbol: 'CMD',
        logoUrl: null,
        templateName: 'Pro Trader',
        domainMode: DomainMode.custom,
        subdomain: '',
        customDomain: 'www.commandfi.xyz',
        siteTitle: 'Command Finance',
        tagline: 'Chart-forward trading, on-chain.',
        accentColor: '#3b82f6',
        status: 'live',
    },
    {
        id: 'mock-3',
        tokenId: 'mock-token-3',
        tokenMintPublicKey: 'NblaX7pQ2vB9nR3wT8sY6uC1fA4jH0lE5eN9mXpQzM',
        tokenName: 'Nebula',
        tokenSymbol: 'NBLA',
        logoUrl: null,
        templateName: 'Minimal',
        domainMode: DomainMode.subdomain,
        subdomain: 'nebula',
        customDomain: '',
        siteTitle: 'Nebula',
        tagline: '',
        accentColor: '#8b5cf6',
        status: 'draft',
    },
]

type Props = {
    selectedSiteId: string | null
    onSelect: (site: MockExistingSite) => void
}

export default function SiteExistingSelect({ selectedSiteId, onSelect }: Props) {
    return (
        <div className="w-full flex flex-col gap-3">
            <p className="text-xs text-muted-foreground rounded-md border border-dashed px-3 py-2">
                Showing placeholder data — the &quot;my sites&quot; listing isn&apos;t wired up to real data yet.
            </p>

            <div className="flex flex-col divide-y divide-border rounded-lg border">
                {mockExistingSites.map((site) => {
                    const isSelected = selectedSiteId === site.id
                    const domain = site.domainMode === DomainMode.custom
                        ? site.customDomain
                        : site.subdomain
                            ? `${site.subdomain}.solanacommand.site`
                            : '—'

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
                                {site.tokenSymbol.slice(0, 1)}
                            </span>

                            <span className="w-40 shrink-0 flex flex-col">
                                <span className="text-sm font-medium">{site.tokenName}</span>
                                <span className="text-xs text-muted-foreground font-mono">{site.tokenSymbol}</span>
                            </span>

                            <span className="w-32 shrink-0 text-xs text-muted-foreground">{site.templateName}</span>

                            <span className="flex-1 min-w-0 truncate text-xs font-mono text-muted-foreground">{domain}</span>

                            <Badge variant={site.status === 'live' ? 'default' : 'outline'} className="shrink-0 capitalize">
                                {site.status}
                            </Badge>
                        </button>
                    )
                })}
            </div>
        </div>
    )
}
