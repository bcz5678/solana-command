'use client'

import { useState, useEffect, useMemo, Fragment } from 'react'
import type { WalletRecord } from '@/lib/types/wallet'
import { Button } from '@/components/ui/button'
import { FieldLabel } from '@/components/ui/field'
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogDescription,
    DialogFooter,
    DialogClose,
} from '@/components/ui/dialog'
import {
    Tooltip,
    TooltipContent,
    TooltipProvider,
    TooltipTrigger,
} from '@/components/ui/tooltip'
import { Copy, ExternalLink } from 'lucide-react'
import TokenPicker, { type TokenPickerValue } from './token-picker'

function maskPubKey(key: string) {
    return `${key.slice(0, 7)}....${key.slice(-7)}`
}

// bigint literal syntax (`0n`) trips TS2737 under this repo's tsconfig
// target — BigInt(0) is functionally identical, just not literal syntax.
const ZERO_RAW = BigInt(0)

function Checkmark() {
    return (
        <svg viewBox="0 0 10 8" fill="none" className="size-3 text-white" stroke="currentColor" strokeWidth={1.8}>
            <path d="M1 4l3 3 5-6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
    )
}

function Dash() {
    return <span className="block w-2.5 h-0.5 bg-white rounded" />
}

type WalletGroup = {
    id: string
    name: string
    color: string | null
    wallets: WalletRecord[]
}

type PreviewPhase = 'calculating' | 'ready' | 'executing' | 'done'
type TransferStatus = 'pending' | 'loading' | 'success' | 'error'

interface RebalanceWalletBalance {
    walletId:   string
    publicKey:  string
    label:      string | null
    balanceRaw: bigint
}

interface RebalanceLeg {
    id:              string // `${sourceWalletId}:${destWalletId}`
    sourceWalletId:  string
    sourcePublicKey: string
    sourceLabel:     string | null
    destWalletId:    string
    destPublicKey:   string
    destLabel:       string | null
    amountRaw:       bigint
}

interface RebalanceShortfall {
    sourceWalletId:  string
    sourcePublicKey: string
    sourceLabel:     string | null
    shortfallRaw:    bigint
}

interface RebalancePlan {
    legs:              RebalanceLeg[]
    totalExcessRaw:    bigint
    totalAllocatedRaw: bigint
    shortfalls:        RebalanceShortfall[]
}

// cap = totalSupplyRaw * capPct / 100, capPct scaled ×1000 so a fractional
// percentage (e.g. 1.5) works without floating-point bigint math — same
// trick already used elsewhere in this codebase for percentage-of-raw math.
function computeCapRaw(totalSupplyRaw: bigint, capPct: number): bigint {
    const capPctScaled = BigInt(Math.round(capPct * 1000))
    return (totalSupplyRaw * capPctScaled) / BigInt(100000)
}

/**
 * Moves excess above `capRaw` from over-cap sources to user-picked
 * destinations (caller has already filtered destinations to exactly 0
 * balance), such that no destination ends up above capRaw either.
 *
 * Sources are processed largest-excess-first (same LPT heuristic
 * computeBalancedFundingAssignment uses in transfer-form.tsx) — minimizes
 * how many destinations one big excess fragments across, and surfaces any
 * shortfall against the biggest source first rather than spread thin.
 *
 * Destinations are sorted by public key ascending — an arbitrary but fully
 * deterministic tiebreak: every destination starts at 0 balance (identical
 * empty capRaw-sized buckets), so which specific bucket fills first cannot
 * change the total amount placed or the shortfall, only which exact
 * (source, dest) pairs appear in the plan.
 *
 * A destination fills from however many sources it takes to reach capRaw,
 * then the walk moves on permanently — one destination can receive legs
 * from multiple sources, one source's excess can split across multiple
 * destinations, but each (source, dest) pair produces at most one leg.
 */
function computeRebalancePlan(
    sources: RebalanceWalletBalance[],
    destinations: RebalanceWalletBalance[],
    capRaw: bigint,
): RebalancePlan {
    const sortedSources = [...sources].sort((a, b) => {
        const ea = a.balanceRaw - capRaw, eb = b.balanceRaw - capRaw
        return eb > ea ? 1 : eb < ea ? -1 : 0
    })
    const sortedDests = [...destinations].sort((a, b) => a.publicKey.localeCompare(b.publicKey))
    const destRemaining = sortedDests.map(() => capRaw)
    let destIdx = 0

    const legs: RebalanceLeg[] = []
    const shortfalls: RebalanceShortfall[] = []
    let totalExcessRaw = ZERO_RAW
    let totalAllocatedRaw = ZERO_RAW

    for (const src of sortedSources) {
        let remaining = src.balanceRaw - capRaw
        totalExcessRaw += remaining

        while (remaining > ZERO_RAW && destIdx < sortedDests.length) {
            const dest = sortedDests[destIdx]
            const take = remaining < destRemaining[destIdx] ? remaining : destRemaining[destIdx]
            if (take > ZERO_RAW) {
                legs.push({
                    id: `${src.walletId}:${dest.walletId}`,
                    sourceWalletId: src.walletId, sourcePublicKey: src.publicKey, sourceLabel: src.label,
                    destWalletId: dest.walletId, destPublicKey: dest.publicKey, destLabel: dest.label,
                    amountRaw: take,
                })
                remaining -= take
                destRemaining[destIdx] -= take
                totalAllocatedRaw += take
            }
            if (destRemaining[destIdx] === ZERO_RAW) destIdx++
        }

        if (remaining > ZERO_RAW) {
            shortfalls.push({ sourceWalletId: src.walletId, sourcePublicKey: src.publicKey, sourceLabel: src.label, shortfallRaw: remaining })
        }
    }

    return { legs, totalExcessRaw, totalAllocatedRaw, shortfalls }
}

function formatAmount(raw: bigint, decimals: number): string {
    return (Number(raw) / 10 ** decimals).toLocaleString(undefined, { maximumFractionDigits: Math.min(decimals, 6) })
}

export default function TokenRebalanceForm() {
    const [wallets, setWallets]                   = useState<WalletRecord[]>([])
    const [walletTypes, setWalletTypes]           = useState<{ id: string; name: string }[]>([])
    const [loading, setLoading]                   = useState(true)
    const [activeFilters, setActiveFilters]       = useState<string[]>([])

    const [token, setToken] = useState<TokenPickerValue>({ mintAddress: '', mintValid: false, tokenSymbol: null, logoUrl: null })
    const [capPct, setCapPct]                   = useState('1')
    const [balances, setBalances]               = useState<Record<string, string>>({}) // walletId -> raw balance
    const [decimals, setDecimals]               = useState(6)
    const [totalSupplyRaw, setTotalSupplyRaw]   = useState<bigint | null>(null)
    const [scanLoading, setScanLoading]         = useState(false)
    const [scanError, setScanError]             = useState('')
    const [selectedDestIds, setSelectedDestIds] = useState<Set<string>>(new Set())

    const [previewOpen, setPreviewOpen]     = useState(false)
    const [previewPhase, setPreviewPhase]   = useState<PreviewPhase>('calculating')
    const [legs, setLegs]                   = useState<RebalanceLeg[]>([])
    const [legStatuses, setLegStatuses]     = useState<Record<string, TransferStatus>>({})
    const [shortfallWarning, setShortfallWarning] = useState('')
    const [validationError, setValidationError]   = useState('')
    const [copiedId, setCopiedId]                 = useState<string | null>(null)

    useEffect(() => {
        fetch('/api/wallets/explorer')
            .then((r) => (r.ok ? r.json() : null))
            .then((data) => {
                if (!data) return
                setWallets((data.wallets ?? []) as WalletRecord[])
                setWalletTypes(data.walletTypes ?? [])
            })
            .catch(() => {})
            .finally(() => setLoading(false))
    }, [])

    // Scan — re-fetches balances + total supply whenever the mint changes.
    useEffect(() => {
        setBalances({})
        setTotalSupplyRaw(null)
        setScanError('')
        setSelectedDestIds(new Set())
        if (!token.mintValid || wallets.length === 0) return
        let cancelled = false
        setScanLoading(true)
        fetch('/api/wallet/token-balances', {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify({ mintAddress: token.mintAddress, walletAddresses: wallets.map((w) => w.public_key) }),
        })
            .then((r) => (r.ok ? r.json() : null))
            .then((data) => {
                if (cancelled) return
                if (!data) { setScanError('Failed to scan balances.'); return }
                setDecimals(data.decimals ?? 6)
                setTotalSupplyRaw(BigInt(data.totalSupply ?? '0'))
                const byId: Record<string, string> = {}
                for (const w of wallets) {
                    const raw = data.balances?.[w.public_key]
                    if (raw !== undefined) byId[w.id] = raw
                }
                setBalances(byId)
            })
            .catch(() => { if (!cancelled) setScanError('Failed to scan balances.') })
            .finally(() => { if (!cancelled) setScanLoading(false) })
        return () => { cancelled = true }
    }, [token.mintValid, token.mintAddress, wallets])

    const capRaw = useMemo(
        () => (totalSupplyRaw == null ? ZERO_RAW : computeCapRaw(totalSupplyRaw, parseFloat(capPct) || 0)),
        [totalSupplyRaw, capPct],
    )

    const sourceWallets = useMemo<RebalanceWalletBalance[]>(() => {
        if (totalSupplyRaw == null) return []
        return wallets
            .map((w) => ({ walletId: w.id, publicKey: w.public_key, label: w.label, balanceRaw: BigInt(balances[w.id] ?? '0') }))
            .filter((x) => x.balanceRaw > capRaw)
    }, [wallets, balances, capRaw, totalSupplyRaw])

    const zeroBalanceWallets = useMemo(
        () => wallets.filter((w) => BigInt(balances[w.id] ?? '0') === ZERO_RAW),
        [wallets, balances],
    )

    const visibleDestWallets = useMemo(() => {
        if (activeFilters.length === 0) return zeroBalanceWallets
        return zeroBalanceWallets.filter((w) => w.wallet_type_id != null && activeFilters.includes(w.wallet_type_id))
    }, [zeroBalanceWallets, activeFilters])

    const destGroups = useMemo<WalletGroup[]>(() => {
        const map = new Map<string, WalletGroup>()
        for (const w of visibleDestWallets) {
            if (!w.wallet_group_id || !w.group_name) continue
            if (!map.has(w.wallet_group_id)) {
                map.set(w.wallet_group_id, { id: w.wallet_group_id, name: w.group_name, color: w.group_color, wallets: [] })
            }
            map.get(w.wallet_group_id)!.wallets.push(w)
        }
        return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name))
    }, [visibleDestWallets])

    const ungroupedDest = useMemo(() => visibleDestWallets.filter((w) => !w.wallet_group_id), [visibleDestWallets])
    const allVisibleDestIds = useMemo(() => visibleDestWallets.map((w) => w.id), [visibleDestWallets])

    function toggleFilter(typeId: string) {
        setActiveFilters((prev) => (prev.includes(typeId) ? prev.filter((id) => id !== typeId) : [...prev, typeId]))
    }

    function toggleDest(id: string) {
        setSelectedDestIds((prev) => {
            const next = new Set(prev)
            next.has(id) ? next.delete(id) : next.add(id)
            return next
        })
    }

    function toggleDestGroup(groupWallets: WalletRecord[]) {
        const allSelected = groupWallets.every((w) => selectedDestIds.has(w.id))
        setSelectedDestIds((prev) => {
            const next = new Set(prev)
            groupWallets.forEach((w) => (allSelected ? next.delete(w.id) : next.add(w.id)))
            return next
        })
    }

    function selectAllDest() {
        setSelectedDestIds((prev) => new Set([...prev, ...allVisibleDestIds]))
    }

    function clearAllDest() {
        setSelectedDestIds((prev) => {
            const next = new Set(prev)
            allVisibleDestIds.forEach((id) => next.delete(id))
            return next
        })
    }

    function copyKey(e: React.MouseEvent, key: string, id: string) {
        e.stopPropagation()
        navigator.clipboard.writeText(key)
        setCopiedId(id)
        setTimeout(() => setCopiedId(null), 2000)
    }

    function openPreview() {
        setValidationError('')
        if (sourceWallets.length === 0) { setValidationError('No wallets are currently over the cap for this token.'); return }
        if (selectedDestIds.size === 0) { setValidationError('Select at least one destination wallet.'); return }

        const destinations: RebalanceWalletBalance[] = wallets
            .filter((w) => selectedDestIds.has(w.id))
            .map((w) => ({ walletId: w.id, publicKey: w.public_key, label: w.label, balanceRaw: BigInt(balances[w.id] ?? '0') }))

        setPreviewOpen(true)
        setPreviewPhase('calculating')
        setLegs([])
        setLegStatuses({})
        setShortfallWarning('')

        setTimeout(() => {
            const plan = computeRebalancePlan(sourceWallets, destinations, capRaw)
            setLegs(plan.legs)
            if (plan.shortfalls.length > 0) {
                const names = plan.shortfalls
                    .map((s) => `${s.sourceLabel ?? maskPubKey(s.sourcePublicKey)} (${formatAmount(s.shortfallRaw, decimals)} left over)`)
                    .join(', ')
                setShortfallWarning(`Not enough destination capacity selected — some excess couldn't be placed: ${names}. Check more destination wallets.`)
            }
            setPreviewPhase('ready')
        }, 400)
    }

    function resetAfterExecute() {
        setPreviewOpen(false)
        setPreviewPhase('calculating')
        setLegs([])
        setLegStatuses({})
        setShortfallWarning('')
        setSelectedDestIds(new Set())
    }

    async function sendLegs(batch: RebalanceLeg[]) {
        try {
            const res = await fetch('/api/wallet/transfer/token/many-to-many', {
                method:  'POST',
                headers: { 'Content-Type': 'application/json' },
                body:    JSON.stringify({
                    mintAddress: token.mintAddress,
                    transfers: batch.map((l) => ({
                        fromWalletId: l.sourceWalletId,
                        toWalletId:   l.destWalletId,
                        toAddress:    l.destPublicKey,
                        amount:       Number(l.amountRaw) / 10 ** decimals,
                    })),
                }),
            })
            if (res.ok) {
                const { results } = await res.json()
                const updates: Record<string, TransferStatus> = {}
                ;(results as { success: boolean }[]).forEach((r, i) => { updates[batch[i].id] = r.success ? 'success' : 'error' })
                setLegStatuses((prev) => ({ ...prev, ...updates }))
            } else {
                const updates: Record<string, TransferStatus> = {}
                batch.forEach((l) => { updates[l.id] = 'error' })
                setLegStatuses((prev) => ({ ...prev, ...updates }))
            }
        } catch {
            const updates: Record<string, TransferStatus> = {}
            batch.forEach((l) => { updates[l.id] = 'error' })
            setLegStatuses((prev) => ({ ...prev, ...updates }))
        }
    }

    async function executeRebalance() {
        setPreviewPhase('executing')
        const initial: Record<string, TransferStatus> = {}
        legs.forEach((l) => { initial[l.id] = 'loading' })
        setLegStatuses(initial)

        // One batched call, not one-per-sender — the many-to-many route
        // already sequences transfers itself (fresh blockhash spacing) and
        // pre-flight-checks each sender's total across the whole batch, so
        // firing it once with every leg is both correct and simpler than
        // splitting by sender.
        await sendLegs(legs)
        setPreviewPhase('done')
    }

    async function retryLeg(leg: RebalanceLeg) {
        setLegStatuses((prev) => ({ ...prev, [leg.id]: 'loading' }))
        await sendLegs([leg])
    }

    const legsBySource = useMemo(() => {
        const map = new Map<string, RebalanceLeg[]>()
        legs.forEach((l) => {
            const arr = map.get(l.sourceWalletId) ?? []
            arr.push(l)
            map.set(l.sourceWalletId, arr)
        })
        return Array.from(map.values())
    }, [legs])

    function renderDestGroupHeader(group: WalletGroup) {
        const allSelected  = group.wallets.every((w) => selectedDestIds.has(w.id))
        const someSelected = !allSelected && group.wallets.some((w) => selectedDestIds.has(w.id))
        return (
            <tr
                key={`group-${group.id}`}
                className="border-b bg-muted/50 cursor-pointer hover:bg-muted/70 transition-colors select-none"
                onClick={() => toggleDestGroup(group.wallets)}
            >
                <td colSpan={4} className="px-3 py-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    <span className="flex items-center gap-2">
                        {group.color && (
                            <span className="inline-block size-2 rounded-full shrink-0" style={{ backgroundColor: group.color }} />
                        )}
                        {group.name}
                        <span className="normal-case tracking-normal font-normal opacity-60">({group.wallets.length})</span>
                    </span>
                </td>
                <td className="px-3 py-2 text-right">
                    <span className={[
                        'inline-flex size-5 items-center justify-center rounded border-2 transition-colors',
                        allSelected ? 'border-blue-500 bg-blue-500' : someSelected ? 'border-blue-400 bg-blue-400/30' : 'border-muted-foreground/40 hover:border-blue-400',
                    ].join(' ')}>
                        {allSelected ? <Checkmark /> : someSelected ? <Dash /> : null}
                    </span>
                </td>
            </tr>
        )
    }

    let destRowIndex = 0

    function renderDestRow(wallet: WalletRecord, n: number) {
        const checked = selectedDestIds.has(wallet.id)
        return (
            <tr
                key={wallet.id}
                onClick={() => toggleDest(wallet.id)}
                className={['border-b cursor-pointer transition-colors', checked ? 'bg-blue-500/5 hover:bg-blue-500/10' : 'hover:bg-muted/30'].join(' ')}
            >
                <td className="px-3 py-2.5 text-muted-foreground tabular-nums text-xs">{n}</td>
                <td className="px-3 py-2.5 font-mono text-xs">
                    <span className="flex items-center gap-1">
                        <span className="truncate">{maskPubKey(wallet.public_key)}</span>
                        <TooltipProvider>
                            <Tooltip open={copiedId === wallet.id ? true : undefined}>
                                <TooltipTrigger asChild>
                                    <span
                                        role="button"
                                        tabIndex={0}
                                        onClick={(e) => copyKey(e, wallet.public_key, wallet.id)}
                                        className="flex items-center justify-center rounded p-0.5 text-muted-foreground hover:text-foreground hover:bg-muted transition-colors cursor-pointer shrink-0"
                                        aria-label="Copy public key"
                                    >
                                        <Copy className="size-3" />
                                    </span>
                                </TooltipTrigger>
                                <TooltipContent side="top">{copiedId === wallet.id ? 'Copied to clipboard' : 'Copy address'}</TooltipContent>
                            </Tooltip>
                        </TooltipProvider>
                        <TooltipProvider>
                            <Tooltip>
                                <TooltipTrigger asChild>
                                    <a
                                        href={`https://solscan.io/account/${wallet.public_key}`}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        onClick={(e) => e.stopPropagation()}
                                        className="flex items-center justify-center rounded p-0.5 text-muted-foreground hover:text-foreground hover:bg-muted transition-colors shrink-0"
                                        aria-label="View on Solscan"
                                    >
                                        <ExternalLink className="size-3" />
                                    </a>
                                </TooltipTrigger>
                                <TooltipContent side="top">View on Solscan</TooltipContent>
                            </Tooltip>
                        </TooltipProvider>
                    </span>
                </td>
                <td className="px-3 py-2.5 text-xs text-muted-foreground">{wallet.label ?? <span className="opacity-40">—</span>}</td>
                <td className="px-3 py-2.5 text-right text-muted-foreground tabular-nums text-xs">0 {token.tokenSymbol ?? ''}</td>
                <td className="px-3 py-2.5 text-right">
                    <span
                        onClick={(e) => { e.stopPropagation(); toggleDest(wallet.id) }}
                        className={[
                            'inline-flex size-5 cursor-pointer items-center justify-center rounded border-2 transition-colors',
                            checked ? 'border-blue-500 bg-blue-500' : 'border-muted-foreground/40 hover:border-blue-400',
                        ].join(' ')}
                    >
                        {checked && <Checkmark />}
                    </span>
                </td>
            </tr>
        )
    }

    if (loading) return <p className="text-sm text-muted-foreground py-4">Loading wallets…</p>

    return (
        <>
            <div className="flex flex-col gap-6">

                {/* Token + cap */}
                <div className="flex flex-wrap items-end gap-4">
                    <div className="max-w-sm flex-1 min-w-64">
                        <TokenPicker onChange={setToken} />
                    </div>
                    <div className="flex flex-col gap-1.5">
                        <label htmlFor="rebalance-cap-pct" className="text-xs text-muted-foreground whitespace-nowrap">Cap % of supply</label>
                        <input
                            id="rebalance-cap-pct"
                            type="number"
                            min={0}
                            step={0.1}
                            value={capPct}
                            onChange={(e) => setCapPct(e.target.value)}
                            className="w-24 rounded border border-input bg-background px-2 py-1 text-right text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                        />
                    </div>
                </div>

                {scanLoading && <p className="text-xs text-muted-foreground">Scanning wallet balances…</p>}
                {scanError && <p className="text-xs text-destructive">{scanError}</p>}

                {/* Over-cap wallets — read only, auto-detected */}
                {token.mintValid && totalSupplyRaw != null && (
                    <div className="flex flex-col gap-2">
                        <FieldLabel>Over-Cap Wallets ({sourceWallets.length})</FieldLabel>
                        <p className="text-xs text-muted-foreground">
                            Cap is {formatAmount(capRaw, decimals)} {token.tokenSymbol ?? 'tokens'} ({capPct || '0'}% of {formatAmount(totalSupplyRaw, decimals)} total supply). Wallets under the cap are left alone.
                        </p>
                        {sourceWallets.length === 0 ? (
                            <p className="text-xs text-muted-foreground">No wallet currently holds more than the cap.</p>
                        ) : (
                            <div className="w-full overflow-x-auto rounded-md border">
                                <table className="w-full text-sm border-collapse">
                                    <thead className="bg-muted">
                                        <tr className="border-b text-xs font-medium uppercase tracking-wider text-muted-foreground">
                                            <th className="px-3 py-2.5 text-left">Public Key</th>
                                            <th className="px-3 py-2.5 text-left">Label</th>
                                            <th className="px-3 py-2.5 text-right">Balance</th>
                                            <th className="px-3 py-2.5 text-right">Excess</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {sourceWallets.map((s) => (
                                            <tr key={s.walletId} className="border-b">
                                                <td className="px-3 py-2.5 font-mono text-xs">{maskPubKey(s.publicKey)}</td>
                                                <td className="px-3 py-2.5 text-xs text-muted-foreground">{s.label ?? <span className="opacity-40">—</span>}</td>
                                                <td className="px-3 py-2.5 text-right tabular-nums text-xs">{formatAmount(s.balanceRaw, decimals)}</td>
                                                <td className="px-3 py-2.5 text-right tabular-nums text-xs font-semibold text-amber-500">
                                                    {formatAmount(s.balanceRaw - capRaw, decimals)}
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        )}
                    </div>
                )}

                {/* Destination wallets — user-picked, zero balance only */}
                {token.mintValid && totalSupplyRaw != null && sourceWallets.length > 0 && (
                    <div className="flex flex-col gap-3">
                        <FieldLabel>Destination Wallets — zero balance ({zeroBalanceWallets.length} available)</FieldLabel>

                        <div className="flex flex-wrap gap-2">
                            <button
                                onClick={() => setActiveFilters([])}
                                className={[
                                    'px-3 py-1 rounded-full text-xs font-medium border transition-colors',
                                    activeFilters.length === 0 ? 'bg-blue-500 border-blue-500 text-white' : 'border-border text-muted-foreground hover:border-blue-400 hover:text-foreground',
                                ].join(' ')}
                            >
                                All
                            </button>
                            {walletTypes.map((type) => (
                                <button
                                    key={type.id}
                                    onClick={() => toggleFilter(type.id)}
                                    className={[
                                        'px-3 py-1 rounded-full text-xs font-medium border transition-colors',
                                        activeFilters.includes(type.id) ? 'bg-blue-500 border-blue-500 text-white' : 'border-border text-muted-foreground hover:border-blue-400 hover:text-foreground',
                                    ].join(' ')}
                                >
                                    {type.name}
                                </button>
                            ))}
                        </div>

                        <div className="w-full overflow-x-auto overflow-y-auto max-h-[420px] rounded-md border">
                            <table className="w-full text-sm border-collapse">
                                <thead className="sticky top-0 z-10 bg-muted">
                                    <tr className="border-b text-xs font-medium uppercase tracking-wider text-muted-foreground">
                                        <th className="px-3 py-2.5 text-left w-10">#</th>
                                        <th className="px-3 py-2.5 text-left">Public Key</th>
                                        <th className="px-3 py-2.5 text-left">Label</th>
                                        <th className="px-3 py-2.5 text-right">Balance</th>
                                        <th className="px-3 py-2.5 text-right">
                                            <div className="flex items-center justify-end gap-2">
                                                Include
                                                <span className="flex gap-1 normal-case tracking-normal font-normal">
                                                    <button onClick={selectAllDest} className="text-[10px] border border-border rounded px-1.5 py-0.5 text-muted-foreground hover:text-blue-500 hover:border-blue-500 transition-colors">All</button>
                                                    <button onClick={clearAllDest} className="text-[10px] border border-border rounded px-1.5 py-0.5 text-muted-foreground hover:text-destructive hover:border-destructive transition-colors">Clear</button>
                                                </span>
                                            </div>
                                        </th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {destGroups.map((group) => (
                                        <Fragment key={group.id}>
                                            {renderDestGroupHeader(group)}
                                            {group.wallets.map((wallet) => renderDestRow(wallet, ++destRowIndex))}
                                        </Fragment>
                                    ))}
                                    {ungroupedDest.length > 0 && (
                                        <Fragment>
                                            {destGroups.length > 0 && (
                                                <tr className="border-b bg-muted/30">
                                                    <td colSpan={5} className="px-3 py-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground/60">Ungrouped</td>
                                                </tr>
                                            )}
                                            {ungroupedDest.map((wallet) => renderDestRow(wallet, ++destRowIndex))}
                                        </Fragment>
                                    )}
                                    {visibleDestWallets.length === 0 && (
                                        <tr>
                                            <td colSpan={5} className="px-3 py-6 text-center text-sm text-muted-foreground">No zero-balance wallets found.</td>
                                        </tr>
                                    )}
                                </tbody>
                            </table>
                        </div>

                        {selectedDestIds.size > 0 && (
                            <p className="text-xs text-muted-foreground">{selectedDestIds.size} destination wallet{selectedDestIds.size !== 1 ? 's' : ''} selected</p>
                        )}
                    </div>
                )}

                {validationError && <p className="text-sm text-destructive">{validationError}</p>}

                {token.mintValid && sourceWallets.length > 0 && (
                    <Button size="lg" variant="default" onClick={openPreview} className="w-fit">
                        Preview Rebalance
                    </Button>
                )}
            </div>

            {/* Preview / execute dialog */}
            <Dialog
                open={previewOpen}
                onOpenChange={(open) => {
                    if (open) return
                    if (previewPhase === 'calculating' || previewPhase === 'executing') return
                    if (previewPhase === 'done') resetAfterExecute()
                    else setPreviewOpen(false)
                }}
            >
                <DialogContent className="max-w-lg">
                    <DialogHeader>
                        <DialogTitle>
                            {previewPhase === 'calculating' && 'Calculating Rebalance…'}
                            {previewPhase === 'ready' && 'Preview Rebalance'}
                            {previewPhase === 'executing' && 'Sending Transfers…'}
                            {previewPhase === 'done' && 'Rebalance Complete'}
                        </DialogTitle>
                        <DialogDescription>
                            {previewPhase === 'calculating'
                                ? 'Packing excess above the cap into the selected destination wallets…'
                                : `${legsBySource.length} source${legsBySource.length !== 1 ? 's' : ''} → ${new Set(legs.map((l) => l.destWalletId)).size} destination${new Set(legs.map((l) => l.destWalletId)).size !== 1 ? 's' : ''}, ${legs.length} transfer${legs.length !== 1 ? 's' : ''} total`}
                        </DialogDescription>
                    </DialogHeader>

                    {previewPhase === 'calculating' && (
                        <div className="flex flex-col items-center gap-3 py-10 text-muted-foreground">
                            <span className="size-8 animate-spin rounded-full border-2 border-blue-500 border-t-transparent" />
                            <p className="text-sm">Calculating rebalance…</p>
                        </div>
                    )}

                    {previewPhase !== 'calculating' && (
                        <>
                            {shortfallWarning && <p className="text-xs text-destructive">{shortfallWarning}</p>}
                            <p className="text-xs text-muted-foreground -mt-1">
                                Each source wallet pays its own network fees and destination-ATA rent — ensure sources hold a small SOL buffer.
                            </p>

                            <div className="flex flex-col gap-4 max-h-[420px] overflow-y-auto pr-1">
                                {legsBySource.map((sourceLegs) => {
                                    const subtotal = sourceLegs.reduce((s, l) => s + l.amountRaw, ZERO_RAW)
                                    return (
                                        <div key={sourceLegs[0].sourceWalletId} className="flex flex-col gap-1.5">
                                            <div className="flex items-center justify-between border-b pb-1">
                                                <span className="text-xs font-semibold text-foreground truncate">
                                                    {sourceLegs[0].sourceLabel ? `${sourceLegs[0].sourceLabel} · ` : ''}
                                                    {maskPubKey(sourceLegs[0].sourcePublicKey)}
                                                </span>
                                                <span className="text-xs text-muted-foreground tabular-nums shrink-0">
                                                    {formatAmount(subtotal, decimals)} {token.tokenSymbol ?? ''}
                                                </span>
                                            </div>
                                            <div className="flex flex-col divide-y">
                                                {sourceLegs.map((leg) => {
                                                    const status = legStatuses[leg.id] ?? 'pending'
                                                    return (
                                                        <div key={leg.id} className="flex items-center gap-2 py-1.5">
                                                            {previewPhase !== 'ready' && (
                                                                <div className="size-4 shrink-0 flex items-center justify-center">
                                                                    {status === 'pending' && <span className="size-2 rounded-full bg-muted-foreground/30" />}
                                                                    {status === 'loading' && <span className="size-3.5 animate-spin rounded-full border-2 border-blue-500 border-t-transparent" />}
                                                                    {status === 'success' && (
                                                                        <svg className="size-4 text-green-500" viewBox="0 0 20 20" fill="currentColor">
                                                                            <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                                                                        </svg>
                                                                    )}
                                                                    {status === 'error' && (
                                                                        <svg className="size-4 text-destructive" viewBox="0 0 20 20" fill="currentColor">
                                                                            <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
                                                                        </svg>
                                                                    )}
                                                                </div>
                                                            )}
                                                            <span className="flex-1 min-w-0 truncate text-xs font-mono text-muted-foreground">
                                                                {leg.destLabel ? `${leg.destLabel} · ` : ''}{maskPubKey(leg.destPublicKey)}
                                                            </span>
                                                            <span className="text-xs font-semibold tabular-nums shrink-0">
                                                                {formatAmount(leg.amountRaw, decimals)} {token.tokenSymbol ?? ''}
                                                            </span>
                                                            {status === 'error' && (
                                                                <Button size="sm" variant="outline" className="h-6 shrink-0 px-2 text-[10px]" onClick={() => retryLeg(leg)}>
                                                                    Retry
                                                                </Button>
                                                            )}
                                                        </div>
                                                    )
                                                })}
                                            </div>
                                        </div>
                                    )
                                })}
                            </div>

                            <div className="border-t pt-3 flex justify-between font-semibold text-sm">
                                <span>Total</span>
                                <span className="tabular-nums text-right">
                                    {formatAmount(legs.reduce((s, l) => s + l.amountRaw, ZERO_RAW), decimals)} {token.tokenSymbol ?? ''}
                                </span>
                            </div>
                        </>
                    )}

                    {previewPhase === 'ready' && (
                        <DialogFooter>
                            <DialogClose asChild>
                                <Button variant="outline">Cancel</Button>
                            </DialogClose>
                            <Button variant="default" onClick={executeRebalance} disabled={legs.length === 0}>
                                Confirm {legs.length} Transfer{legs.length !== 1 ? 's' : ''}
                            </Button>
                        </DialogFooter>
                    )}

                    {previewPhase === 'done' && (() => {
                        const total   = legs.length
                        const success = Object.values(legStatuses).filter((s) => s === 'success').length
                        const failed  = total - success
                        return (
                            <>
                                <div className={[
                                    'rounded-md px-4 py-3 text-sm',
                                    failed === 0 ? 'bg-green-500/10 text-green-700 dark:text-green-400' : 'bg-destructive/10 text-destructive',
                                ].join(' ')}>
                                    {failed === 0
                                        ? `All ${success} transfer${success !== 1 ? 's' : ''} submitted successfully.`
                                        : `${success} succeeded, ${failed} failed — retry the failed ones above or close to finish.`}
                                </div>
                                <DialogFooter>
                                    <Button variant="default" onClick={resetAfterExecute}>Done</Button>
                                </DialogFooter>
                            </>
                        )
                    })()}
                </DialogContent>
            </Dialog>
        </>
    )
}
