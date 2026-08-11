'use client'

import { useEffect, useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import { DevSitePanel } from '@/components/dev/dev-site-panel'
import { startSetup, useProvisioning, failureGuidance } from '@/lib/provisioning/client'
import { DomainMode, SiteBuilderConfig } from './types'
import ProvisioningTimeline from './provisioning-timeline'
import BlockResolutionDialog from './block-resolution-dialog'

type DomainPath = 'existing' | 'purchase'
type VerifyStatus = 'idle' | 'checking' | 'owned' | 'not-owned' | 'error'

type SearchResult = {
    domain: string
    available: boolean
    price: number | null
    currency: string | null
}

type DistributionOption = {
    id: string
    domainName: string
    url: string
    aliases: string[]
    originDomain: string
    originPath: string
    etag: string
    enabled: boolean
    status: string
}

type Props = {
    siteId: string
    config: SiteBuilderConfig
    onDomainModeChange: (mode: DomainMode) => void
    onSubdomainChange: (value: string) => void
    onCustomDomainChange: (value: string) => void
    onReadyChange: (ready: boolean) => void
}

export default function SiteDomainSetup({ siteId, config, onDomainModeChange, onCustomDomainChange, onReadyChange }: Props) {
    const [path, setPath] = useState<DomainPath | null>(null)
    const [existingInput, setExistingInput] = useState(config.customDomain)
    const [verifyStatus, setVerifyStatus] = useState<VerifyStatus>('idle')
    const [verifyError, setVerifyError] = useState<string | null>(null)

    const [searchQuery, setSearchQuery] = useState('')
    const [searching, setSearching] = useState(false)
    const [searchError, setSearchError] = useState<string | null>(null)
    const [results, setResults] = useState<SearchResult[]>([])
    const [selectedPurchaseDomain, setSelectedPurchaseDomain] = useState<string | null>(null)

    const [distributions, setDistributions] = useState<DistributionOption[]>([])
    const [loadingDistributions, setLoadingDistributions] = useState(false)
    const [distributionsError, setDistributionsError] = useState<string | null>(null)
    const [selectedDistributionId, setSelectedDistributionId] = useState<string | null>(null)

    const [submitting, setSubmitting] = useState(false)
    const [submitError, setSubmitError] = useState<string | null>(null)

    // Gates retry on a reaped (heartbeat_timeout) run — see failureGuidance().
    // Reset per run so a fresh failure doesn't inherit a stale acknowledgement.
    const [reapAcknowledged, setReapAcknowledged] = useState(false)

    const { current: currentRun, isBlocked, isComplete, isFailed, refresh } = useProvisioning(siteId)

    useEffect(() => {
        setReapAcknowledged(false)
    }, [currentRun?.id])

    const selectedDistribution = distributions.find((d) => d.id === selectedDistributionId) ?? null

    function resetDownstream() {
        setSelectedDistributionId(null)
        setSubmitError(null)
        onReadyChange(false)
    }

    function choosePath(next: DomainPath) {
        if (next === path) return
        setPath(next)
        // Switching paths invalidates whatever the other path had staged.
        onDomainModeChange(DomainMode.custom)
        onCustomDomainChange('')
        setExistingInput('')
        setVerifyStatus('idle')
        setVerifyError(null)
        setSelectedPurchaseDomain(null)
        setResults([])
        setSearchError(null)
        resetDownstream()
    }

    function onExistingDomainChange(value: string) {
        setExistingInput(value)
        onDomainModeChange(DomainMode.custom)
        onCustomDomainChange(value.trim())
        // The domain changed — any prior ownership check (and anything built on it) no longer applies.
        setVerifyStatus('idle')
        setVerifyError(null)
        resetDownstream()
    }

    async function verifyOwnership() {
        const domain = existingInput.trim()
        if (!domain) return

        setVerifyStatus('checking')
        setVerifyError(null)

        try {
            const res = await fetch(`/api/domains/verify?domain=${encodeURIComponent(domain)}`)
            const data = await res.json()
            if (!res.ok) {
                setVerifyStatus('error')
                setVerifyError(data.error ?? 'Ownership check failed')
                return
            }
            setVerifyStatus(data.owned ? 'owned' : 'not-owned')
        } catch (err) {
            console.error('[SiteDomainSetup] verify error:', err)
            setVerifyStatus('error')
            setVerifyError('Ownership check failed')
        }
    }

    async function runSearch() {
        const query = searchQuery.trim()
        if (!query) return

        setSearching(true)
        setSearchError(null)
        setResults([])
        setSelectedPurchaseDomain(null)

        try {
            const res = await fetch(`/api/domains/search?query=${encodeURIComponent(query)}`)
            const data = await res.json()
            if (!res.ok) {
                setSearchError(data.error ?? 'Domain search failed')
                return
            }
            setResults(data.results ?? [])
        } catch (err) {
            console.error('[SiteDomainSetup] search error:', err)
            setSearchError('Domain search failed')
        } finally {
            setSearching(false)
        }
    }

    function selectPurchaseDomain(domain: string) {
        setSelectedPurchaseDomain(domain)
        onDomainModeChange(DomainMode.custom)
        onCustomDomainChange(domain)
    }

    // Load CloudFront distributions once the domain to attach is confirmed owned.
    useEffect(() => {
        if (path !== 'existing' || verifyStatus !== 'owned') return
        if (distributions.length > 0 || loadingDistributions) return

        setLoadingDistributions(true)
        setDistributionsError(null)

        fetch('/api/domains/distributions')
            .then((r) => r.json().then((data) => ({ ok: r.ok, data })))
            .then(({ ok, data }) => {
                if (!ok) {
                    setDistributionsError(data.error ?? 'Failed to load distributions')
                    return
                }
                setDistributions(data.distributions ?? [])
            })
            .catch((err) => {
                console.error('[SiteDomainSetup] distributions error:', err)
                setDistributionsError('Failed to load distributions')
            })
            .finally(() => setLoadingDistributions(false))
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [path, verifyStatus])

    function selectDistribution(id: string) {
        setSelectedDistributionId(id)
        setSubmitError(null)
    }

    async function confirmAndStartSetup() {

        console.log("[start]", `/api/sites/${siteId}/provisioning`, { siteId });

        if (!selectedDistributionId || !existingInput.trim() || !selectedDistribution) return

        setSubmitting(true)
        setSubmitError(null)

        try {
            // domain + domainSource select and start in one request — this path
            // has no preceding purchase run, so nothing else has recorded them.
            await startSetup(
                siteId,
                selectedDistributionId,
                selectedDistribution.url,
                'in_account',
                existingInput.trim(),
            )
            // Realtime will pick up the new run, but an eager refetch avoids a
            // beat of stale UI while that subscription round-trips.
            await refresh()
        } catch (err) {
            console.error('[SiteDomainSetup] setup start error:', err)
            setSubmitError(err instanceof Error ? err.message : 'Failed to start domain setup')
        } finally {
            setSubmitting(false)
        }
    }

    useEffect(() => {
        if (isComplete) onReadyChange(true)
    }, [isComplete, onReadyChange])

    return (
        <div className="w-full flex flex-col gap-4">
            {/* Step 1 — how do you want to set up your domain? */}
            <div className="flex flex-row gap-4 w-full">
                <button
                    className={[
                        'flex-1 text-left rounded-lg transition-all active:scale-[0.99]',
                        path === 'existing' ? 'ring-2 ring-blue-500' : 'hover:ring-2 hover:ring-blue-400/50',
                    ].join(' ')}
                    onClick={() => choosePath('existing')}
                >
                    <Card className={path === 'existing' ? 'border-blue-500 bg-blue-500/5' : 'hover:border-blue-400/60'}>
                        <CardHeader>
                            <CardTitle>I Already Own a Domain</CardTitle>
                        </CardHeader>
                        <CardContent>
                            <p className="text-sm text-muted-foreground">Point a domain you already own at this site.</p>
                        </CardContent>
                    </Card>
                </button>
                <button
                    className={[
                        'flex-1 text-left rounded-lg transition-all active:scale-[0.99]',
                        path === 'purchase' ? 'ring-2 ring-blue-500' : 'hover:ring-2 hover:ring-blue-400/50',
                    ].join(' ')}
                    onClick={() => choosePath('purchase')}
                >
                    <Card className={path === 'purchase' ? 'border-blue-500 bg-blue-500/5' : 'hover:border-blue-400/60'}>
                        <CardHeader>
                            <CardTitle>Search &amp; Buy a New Domain</CardTitle>
                        </CardHeader>
                        <CardContent>
                            <p className="text-sm text-muted-foreground">Search available domains and purchase one directly.</p>
                        </CardContent>
                    </Card>
                </button>
            </div>

            {/* Step 2a — existing domain */}
            {path === 'existing' && (
                <Card>
                    <CardContent className="flex flex-col gap-2 pt-2">
                        <label className="text-xs font-medium text-muted-foreground">Domain</label>
                        <div className="flex items-center gap-2">
                            <Input
                                value={existingInput}
                                onChange={(e) => onExistingDomainChange(e.target.value)}
                                onKeyDown={(e) => e.key === 'Enter' && verifyOwnership()}
                                placeholder="www.yourtoken.com"
                                className="max-w-72"
                            />
                            <button
                                onClick={verifyOwnership}
                                disabled={verifyStatus === 'checking' || !existingInput.trim()}
                                className="px-3 py-1.5 text-sm rounded border border-blue-500 bg-blue-500 text-white hover:bg-blue-600 hover:border-blue-600 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                            >
                                {verifyStatus === 'checking' ? 'Verifying…' : 'Verify Ownership'}
                            </button>
                        </div>

                        {verifyStatus === 'owned' && (
                            <div className="flex items-center gap-1.5">
                                <Badge variant="default">Verified</Badge>
                                <span className="text-sm text-muted-foreground">This domain is registered under your Namecheap account.</span>
                            </div>
                        )}
                        {verifyStatus === 'not-owned' && (
                            <div className="flex items-center gap-1.5">
                                <Badge variant="destructive">Not Found</Badge>
                                <span className="text-sm text-muted-foreground">This domain wasn&apos;t found in your Namecheap account. Double-check for typos.</span>
                            </div>
                        )}
                        {verifyStatus === 'error' && (
                            <p className="text-sm text-destructive">{verifyError}</p>
                        )}
                        {verifyStatus !== 'owned' && (
                            <p className="text-sm text-muted-foreground pt-1">
                                Ownership must be verified against your Namecheap account before continuing.
                            </p>
                        )}
                    </CardContent>
                </Card>
            )}

            {/* Step 2b — search for a domain to purchase */}
            {path === 'purchase' && (
                <Card>
                    <CardContent className="flex flex-col gap-3 pt-2">
                        <div className="flex items-end gap-2">
                            <div className="flex flex-col gap-1.5">
                                <label className="text-xs font-medium text-muted-foreground">Search domains</label>
                                <Input
                                    value={searchQuery}
                                    onChange={(e) => setSearchQuery(e.target.value)}
                                    onKeyDown={(e) => e.key === 'Enter' && runSearch()}
                                    placeholder="yourtoken"
                                    className="max-w-72"
                                />
                            </div>
                            <button
                                onClick={runSearch}
                                disabled={searching || !searchQuery.trim()}
                                className="px-3 py-1.5 text-sm rounded border border-blue-500 bg-blue-500 text-white hover:bg-blue-600 hover:border-blue-600 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                            >
                                {searching ? 'Searching…' : 'Search'}
                            </button>
                        </div>

                        {searchError && (
                            <p className="text-sm text-destructive">{searchError}</p>
                        )}

                        {results.length > 0 && (
                            <div className="flex flex-col divide-y divide-border rounded-lg border">
                                {results.map((result) => (
                                    <div key={result.domain} className="flex items-center gap-4 px-4 py-2.5 text-sm">
                                        <span className="flex-1 font-mono truncate">{result.domain}</span>
                                        {result.available ? (
                                            <>
                                                <span className="text-xs text-muted-foreground">
                                                    {result.price !== null ? `$${result.price.toFixed(2)}/yr` : ''}
                                                </span>
                                                <Badge variant="default">Available</Badge>
                                                <button
                                                    onClick={() => selectPurchaseDomain(result.domain)}
                                                    className={[
                                                        'px-2.5 py-1 text-xs font-medium rounded-md border transition-colors',
                                                        selectedPurchaseDomain === result.domain
                                                            ? 'border-blue-500 bg-blue-500 text-white'
                                                            : 'border-border hover:bg-muted',
                                                    ].join(' ')}
                                                >
                                                    {selectedPurchaseDomain === result.domain ? 'Selected' : 'Select'}
                                                </button>
                                            </>
                                        ) : (
                                            <Badge variant="outline" className="text-muted-foreground">Taken</Badge>
                                        )}
                                    </div>
                                ))}
                            </div>
                        )}
                    </CardContent>
                </Card>
            )}

            {/* Step 2b confirmation (checkout comes in a later step of this build) */}
            {path === 'purchase' && selectedPurchaseDomain && (
                <Card>
                    <CardContent className="flex flex-col gap-1.5 pt-2">
                        <p className="text-sm">
                            <span className="font-mono">{selectedPurchaseDomain}</span> selected.
                        </p>
                        <p className="text-xs text-muted-foreground">
                            Checkout (contact details &amp; payment) isn&apos;t wired up yet — that&apos;s the next piece of this build.
                        </p>
                    </CardContent>
                </Card>
            )}

            {/* Step 3 — choose an AWS CloudFront distribution */}
            {path === 'existing' && verifyStatus === 'owned' && !currentRun && (
                <Card>
                    <CardHeader>
                        <CardTitle className="text-base">Choose a CloudFront Distribution</CardTitle>
                    </CardHeader>
                    <CardContent className="flex flex-col gap-3 pt-0">
                        {loadingDistributions && (
                            <p className="text-sm text-muted-foreground">Loading distributions…</p>
                        )}
                        {distributionsError && (
                            <p className="text-sm text-destructive">{distributionsError}</p>
                        )}
                        {!loadingDistributions && !distributionsError && distributions.length === 0 && (
                            <p className="text-sm text-muted-foreground">No CloudFront distributions found.</p>
                        )}

                        {distributions.length > 0 && (
                            <div className="flex flex-col divide-y divide-border rounded-lg border">
                                {distributions.map((dist) => {
                                    const isSelected = selectedDistributionId === dist.id
                                    return (
                                        <button
                                            key={dist.id}
                                            onClick={() => selectDistribution(dist.id)}
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

                                            <span className="flex-1 min-w-0 flex flex-col">
                                                <span className="text-sm font-medium truncate">
                                                    {dist.id}
                                                    <span className="text-muted-foreground font-normal"> — {dist.originPath || '/ (root)'}</span>
                                                </span>
                                                <span className="text-xs text-muted-foreground font-mono truncate">{dist.domainName}</span>
                                            </span>

                                            <Badge variant={dist.enabled ? 'default' : 'outline'} className="shrink-0">
                                                {dist.status}
                                            </Badge>
                                        </button>
                                    )
                                })}
                            </div>
                        )}

                    </CardContent>
                </Card>
            )}

            {/* Step 4 — review & confirm. Origin path isn't shown or entered here —
                start_domain_setup derives it server-side from s3_prefix, so nothing
                client-side should invent or overwrite it. */}
            {path === 'existing' && verifyStatus === 'owned' && selectedDistribution && !currentRun && (
                <Card>
                    <CardHeader>
                        <CardTitle className="text-base">Review Domain Setup</CardTitle>
                    </CardHeader>
                    <CardContent className="flex flex-col gap-3 pt-0">
                        <div className="grid grid-cols-2 gap-x-8 gap-y-3 text-sm">
                            <div>
                                <p className="text-xs text-muted-foreground mb-0.5">Domain</p>
                                <p className="font-mono">{existingInput}</p>
                            </div>
                            <div>
                                <p className="text-xs text-muted-foreground mb-0.5">Distribution</p>
                                <p className="font-mono">{selectedDistribution.id}</p>
                            </div>
                        </div>

                        {submitError && (
                            <p className="text-sm text-destructive">{submitError}</p>
                        )}

                        <div>
                            <button
                                onClick={confirmAndStartSetup}
                                disabled={submitting}
                                className="px-3 py-1.5 text-sm rounded border border-blue-500 bg-blue-500 text-white hover:bg-blue-600 hover:border-blue-600 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                            >
                                {submitting ? 'Starting…' : 'Confirm & Start Setup'}
                            </button>
                        </div>
                    </CardContent>
                </Card>
            )}

            {/* Step 5 — setup progress, per-step via buildTimeline(). */}
            {currentRun && (
                <Card>
                    <CardHeader>
                        <CardTitle className="text-base">
                            {isComplete ? 'Domain Ready' : isFailed ? 'Domain Setup Failed' : isBlocked ? 'Action Needed' : 'Setting Up Domain…'}
                        </CardTitle>
                    </CardHeader>
                    <CardContent className="flex flex-col gap-3 pt-0">
                        <ProvisioningTimeline run={currentRun} />

                        {isFailed && (() => {
                            const guidance = failureGuidance(currentRun)
                            const retryBlocked = guidance.requiresAcknowledgement && !reapAcknowledged

                            return (
                                <div className="flex flex-col gap-2 pt-1">
                                    <div className="flex flex-col gap-1.5 rounded-lg border border-destructive/30 bg-destructive/5 p-3">
                                        <p className="text-sm font-medium text-destructive">{guidance.title}</p>
                                        <p className="text-sm text-muted-foreground">{guidance.body}</p>
                                        {guidance.detail.length > 0 && (
                                            <dl className="flex flex-col gap-0.5 pt-1">
                                                {guidance.detail.map((d) => (
                                                    <div key={d.label} className="flex gap-1.5 text-xs">
                                                        <dt className="text-muted-foreground">{d.label}:</dt>
                                                        <dd className="font-mono">{d.value}</dd>
                                                    </div>
                                                ))}
                                            </dl>
                                        )}
                                    </div>

                                    {guidance.requiresAcknowledgement && (
                                        <label className="flex items-start gap-2 text-sm">
                                            <Checkbox
                                                checked={reapAcknowledged}
                                                onCheckedChange={(checked) => setReapAcknowledged(checked === true)}
                                                className="mt-0.5"
                                            />
                                            <Label className="font-normal">{guidance.acknowledgementLabel}</Label>
                                        </label>
                                    )}

                                    <div>
                                        <button
                                            onClick={confirmAndStartSetup}
                                            disabled={submitting || retryBlocked}
                                            className="px-3 py-1.5 text-sm rounded border border-border disabled:opacity-40 disabled:cursor-not-allowed"
                                        >
                                            Try Again
                                        </button>
                                    </div>
                                </div>
                            )
                        })()}
                    </CardContent>
                </Card>
            )}

            {/* The one place provisioning genuinely needs a human. Rendered
                outside the progress card, as an actual modal — this blocks
                the rest of the wizard until resolved, which is the point. */}
            {isBlocked && currentRun && (
                <BlockResolutionDialog siteId={siteId} run={currentRun} onResolved={refresh} />
            )}

            {process.env.NODE_ENV !== "production" && siteId && (
                <DevSitePanel siteId={siteId} onChanged={refresh} />
            )}
        </div>
    )
}
