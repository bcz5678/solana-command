'use client'

import { useState, useEffect, useMemo, Fragment } from "react";
import type { WalletRecord } from "@/lib/types/wallet";
import { lamportsStringToBN, lamportsBNToSolDisplay, lamportsBNToSolNumber } from "@/lib/lamports";
import { Button } from "@/components/ui/button";
import { FieldLabel } from "@/components/ui/field";
import {
    DropdownMenu,
    DropdownMenuCheckboxItem,
    DropdownMenuContent,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ChevronDown } from "lucide-react";
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogDescription,
    DialogFooter,
    DialogClose,
} from "@/components/ui/dialog";
import {
    Tooltip,
    TooltipContent,
    TooltipProvider,
    TooltipTrigger,
} from "@/components/ui/tooltip";
import { Copy, ExternalLink } from "lucide-react";

type WalletTypeRow = { id: string; name: string };

const usdFormatter = new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
})

function formatUsd(sol: number, solUsdPrice: number | null): string | null {
    if (solUsdPrice == null) return null
    return usdFormatter.format(sol * solUsdPrice)
}

type WalletGroup = {
    id: string
    name: string
    color: string | null
    wallets: WalletRecord[]
}

type TransferStatus = 'pending' | 'loading' | 'success' | 'error'

type PreviewPhase = 'calculating' | 'ready' | 'executing' | 'done'

type FundingLeg = {
    id:                string // `${senderWalletId}:${receiverWalletId}` — unique per (sender, receiver) pair
    senderWalletId:    string
    senderPublicKey:   string
    senderLabel:       string | null
    receiverWalletId:  string
    receiverPublicKey: string
    receiverLabel:     string | null
    amountSOL:         number
}

// A small SOL buffer reserved per sender per potential leg, so the plan doesn't
// assume a sender's entire balance is spendable (base tx fees eat into it).
const RESERVE_PER_LEG_SOL = 0.00001

/**
 * Assigns each receiver to exactly ONE sender wherever a single sender can
 * actually cover it — never split across multiple senders. Splitting every
 * receiver across every sender would create a complete bipartite link
 * between all senders and all receivers, which is the clearest possible
 * clustering signal (co-spend / common-recipient heuristics) and would
 * prove the senders are related — worse than a single funding wallet, not
 * better.
 *
 * This does balance-aware greedy load-balancing (largest-amount receivers
 * placed first): each receiver goes whole to whichever eligible sender is
 * currently least utilized relative to its own capacity, where "eligible"
 * means that sender has enough REMAINING balance left to cover it — a
 * sender that's low on SOL is excluded from receivers it can't actually
 * afford, not just deprioritized. Only when no single sender has enough
 * left for a given receiver does it fall back to splitting that one
 * receiver across the senders with the most remaining capacity.
 */
function computeBalancedFundingAssignment(
    senders: WalletRecord[],
    receivers: { wallet: WalletRecord; amountSOL: number }[],
): { legs: FundingLeg[]; totalNeededSol: number; totalCapacitySol: number } {
    const totalNeededSol = receivers.reduce((s, r) => s + r.amountSOL, 0)
    if (senders.length === 0 || receivers.length === 0) {
        return { legs: [], totalNeededSol, totalCapacitySol: 0 }
    }

    const reservePerSender = receivers.length * RESERVE_PER_LEG_SOL
    const capacities = senders.map((s) => {
        const balSol = s.solana_balance_in_lamports ? lamportsBNToSolNumber(s.solana_balance_in_lamports) : 0
        return Math.max(balSol - reservePerSender, 0)
    })
    const totalCapacitySol = capacities.reduce((a, b) => a + b, 0)
    // No balance data for any sender at all — weight everyone equally by count instead.
    const weights = totalCapacitySol > 0 ? capacities : senders.map(() => 1)

    const assigned  = senders.map(() => 0) // for the utilization ratio (balancing signal)
    const remaining = [...capacities]       // actual spendable SOL left per sender
    // Largest-first (LPT heuristic) keeps the final per-sender totals close to balanced,
    // and means any receiver too big for a single sender gets caught early, while capacity
    // still remains elsewhere to split it.
    const sortedReceivers = [...receivers].sort((a, b) => b.amountSOL - a.amountSOL)

    function makeLeg(senderIdx: number, r: { wallet: WalletRecord; amountSOL: number }, amountSOL: number): FundingLeg {
        const s = senders[senderIdx]
        return {
            id: `${s.id}:${r.wallet.id}`,
            senderWalletId: s.id,
            senderPublicKey: s.public_key,
            senderLabel: s.label,
            receiverWalletId: r.wallet.id,
            receiverPublicKey: r.wallet.public_key,
            receiverLabel: r.wallet.label,
            amountSOL,
        }
    }

    const legs: FundingLeg[] = []
    for (const r of sortedReceivers) {
        // Prefer a single sender that can fully cover this receiver, picking the
        // least-utilized one among those actually able to afford it.
        let pick = -1
        let pickRatio = Infinity
        for (let i = 0; i < senders.length; i++) {
            if (remaining[i] < r.amountSOL) continue
            const ratio = weights[i] > 0 ? assigned[i] / weights[i] : Infinity
            if (ratio < pickRatio) {
                pickRatio = ratio
                pick = i
            }
        }

        if (pick !== -1) {
            assigned[pick]  += r.amountSOL
            remaining[pick] -= r.amountSOL
            legs.push(makeLeg(pick, r, r.amountSOL))
            continue
        }

        // No single sender can cover it — split just this receiver across whichever
        // senders have the most remaining capacity, filling largest-first. Tracks the
        // leg index per sender so a later top-up (see below) merges into it instead of
        // pushing a second leg with the same sender+receiver id.
        const order = senders.map((_, i) => i).sort((a, b) => remaining[b] - remaining[a])
        const legIndexForSender = new Map<number, number>()
        let amountLeft = r.amountSOL
        for (const i of order) {
            if (amountLeft <= 0) break
            const take = Math.min(remaining[i], amountLeft)
            if (take <= 0) continue
            assigned[i]  += take
            remaining[i] -= take
            legs.push(makeLeg(i, r, take))
            legIndexForSender.set(i, legs.length - 1)
            amountLeft -= take
        }
        if (amountLeft > 0) {
            // Combined capacity genuinely can't cover this receiver — pile the shortfall
            // onto whichever sender already took the biggest slice above (merged, not a
            // duplicate leg) so it's visible in the preview rather than silently dropped;
            // totalCapacitySol < totalNeededSol also warns on this case.
            const fallbackIdx = order[0]
            const existingLegIdx = legIndexForSender.get(fallbackIdx)
            if (existingLegIdx !== undefined) {
                legs[existingLegIdx].amountSOL += amountLeft
            } else {
                legs.push(makeLeg(fallbackIdx, r, amountLeft))
            }
        }
    }
    return { legs, totalNeededSol, totalCapacitySol }
}

function maskPubKey(key: string) {
    return `${key.slice(0, 7)}....${key.slice(-7)}`
}

// Wallets are named like "DOLLYPARTED_Trading_1" — pulls the trailing "_<n>" for ordering.
function parseWalletNumber(label: string | null): number | null {
    if (!label) return null
    // Trailing digits, with or without a separator before them — "..._1", "...-1", "...1".
    const m = label.match(/(\d+)\s*$/)
    return m ? parseInt(m[1], 10) : null
}

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

export default function TransferForm() {
    const [wallets, setWallets]                   = useState<WalletRecord[]>([])
    const [walletTypes, setWalletTypes]           = useState<WalletTypeRow[]>([])
    const [loading, setLoading]                   = useState(true)
    const [activeFilters, setActiveFilters]       = useState<string[]>([])
    const [senderWalletIds, setSenderWalletIds]   = useState<Set<string>>(new Set())
    const [selectedReceivers, setSelectedReceivers] = useState<Set<string>>(new Set())
    const [receiverAmounts, setReceiverAmounts]   = useState<Record<string, string>>({})
    const [previewOpen, setPreviewOpen]           = useState(false)
    const [previewPhase, setPreviewPhase]         = useState<PreviewPhase>('calculating')
    const [legs, setLegs]                         = useState<FundingLeg[]>([])
    const [legStatuses, setLegStatuses]           = useState<Record<string, TransferStatus>>({})
    const [distributionWarning, setDistributionWarning] = useState('')
    const [validationError, setValidationError]   = useState('')
    const [copiedId, setCopiedId]                  = useState<string | null>(null)
    const [bondingCurveLoading, setBondingCurveLoading] = useState(false)
    const [bondingCurveMsg, setBondingCurveMsg]         = useState('')
    const [bufferPct, setBufferPct]                     = useState('10')
    const [solUsdPrice, setSolUsdPrice]                 = useState<number | null>(null)

    useEffect(() => {
        fetch('/api/wallets/explorer')
            .then((r) => r.ok ? r.json() : null)
            .then((data) => {
                if (!data) return
                const parsed: WalletRecord[] = (data.wallets ?? []).map((w: any) => ({
                    ...w,
                    solana_balance_in_lamports: w.solana_balance_in_lamports != null
                        ? lamportsStringToBN(String(w.solana_balance_in_lamports))
                        : null,
                }))
                setWallets(parsed)
                setWalletTypes(data.walletTypes ?? [])
            })
            .catch(err => console.error('[wallets] fetch failed', err))
            .finally(() => setLoading(false))

        fetch('/api/price/sol-usd')
            .then((r) => r.json())
            .then(({ solUsd }) => setSolUsdPrice(typeof solUsd === 'number' ? solUsd : null))
            .catch(() => setSolUsdPrice(null))
    }, [])

    // Clear receiver selection when sender selection changes
    useEffect(() => {
        setSelectedReceivers(new Set())
        setReceiverAmounts({})
    }, [senderWalletIds])

    // Sender dropdown — all wallets grouped by type
    const senderGroups = useMemo<[string, WalletRecord[]][]>(() => {
        const map: Record<string, WalletRecord[]> = {}
        for (const w of wallets) {
            const key = w.wallet_type ?? 'Other'
            ;(map[key] ??= []).push(w)
        }
        return Object.entries(map)
    }, [wallets])

    function toggleSender(id: string) {
        setSenderWalletIds((prev) => {
            const next = new Set(prev)
            next.has(id) ? next.delete(id) : next.add(id)
            return next
        })
    }

    // Dev wallets — surfaced separately above the receiver table so they're easy to
    // spot when funding a fresh launch. Not required: a dev wallet may already be funded.
    const devWallets = useMemo(
        () => wallets.filter((w) => !senderWalletIds.has(w.id) && (w.wallet_type ?? '').toLowerCase().includes('dev')),
        [wallets, senderWalletIds],
    )

    // Receiver table — all wallets except the selected senders and dev wallets (shown above), filtered by type
    const visibleWallets = useMemo(() => {
        const devIds = new Set(devWallets.map((w) => w.id))
        const withoutSenders = wallets.filter((w) => !senderWalletIds.has(w.id) && !devIds.has(w.id))
        if (activeFilters.length === 0) return withoutSenders
        return withoutSenders.filter((w) => w.wallet_type_id != null && activeFilters.includes(w.wallet_type_id))
    }, [wallets, senderWalletIds, devWallets, activeFilters])

    const walletGroups = useMemo<WalletGroup[]>(() => {
        const map = new Map<string, WalletGroup>()
        for (const w of visibleWallets) {
            if (!w.wallet_group_id || !w.group_name) continue
            if (!map.has(w.wallet_group_id)) {
                map.set(w.wallet_group_id, { id: w.wallet_group_id, name: w.group_name, color: w.group_color, wallets: [] })
            }
            map.get(w.wallet_group_id)!.wallets.push(w)
        }
        return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name))
    }, [visibleWallets])

    const ungrouped = useMemo(
        () => visibleWallets.filter((w) => !w.wallet_group_id),
        [visibleWallets],
    )

    const allVisibleIds = useMemo(() => visibleWallets.map((w) => w.id), [visibleWallets])

    function toggleFilter(typeId: string) {
        setActiveFilters((prev) =>
            prev.includes(typeId) ? prev.filter((id) => id !== typeId) : [...prev, typeId],
        )
    }

    function toggleWallet(id: string) {
        const next = new Set(selectedReceivers)
        if (next.has(id)) {
            next.delete(id)
            setReceiverAmounts((p) => { const n = { ...p }; delete n[id]; return n })
        } else {
            next.add(id)
        }
        setSelectedReceivers(next)
    }

    function toggleGroup(groupWallets: WalletRecord[]) {
        const allSelected = groupWallets.every((w) => selectedReceivers.has(w.id))
        const next = new Set(selectedReceivers)
        if (allSelected) {
            groupWallets.forEach((w) => {
                next.delete(w.id)
                setReceiverAmounts((p) => { const n = { ...p }; delete n[w.id]; return n })
            })
        } else {
            groupWallets.forEach((w) => next.add(w.id))
        }
        setSelectedReceivers(next)
    }

    function selectAll() {
        const next = new Set(selectedReceivers)
        allVisibleIds.forEach((id) => next.add(id))
        setSelectedReceivers(next)
    }

    function clearAll() {
        const next = new Set(selectedReceivers)
        allVisibleIds.forEach((id) => {
            next.delete(id)
            setReceiverAmounts((p) => { const n = { ...p }; delete n[id]; return n })
        })
        setSelectedReceivers(next)
    }

    async function applyBondingCurveFunding() {
        setBondingCurveMsg('')

        const checkedVisible = visibleWallets.filter((w) => selectedReceivers.has(w.id))
        const checkedTrading = checkedVisible
            .map((w) => ({ wallet: w, num: parseWalletNumber(w.label) }))
            .filter((x): x is { wallet: WalletRecord; num: number } => x.num !== null)
            .sort((a, b) => a.num - b.num)

        if (checkedVisible.length === 0) {
            setBondingCurveMsg('No receiver wallets are checked below — check the ones you want funded, then Calculate.')
            return
        }
        if (checkedTrading.length === 0) {
            const sample = checkedVisible.slice(0, 3).map((w) => w.label ?? maskPubKey(w.public_key)).join(', ')
            setBondingCurveMsg(
                `${checkedVisible.length} wallet${checkedVisible.length !== 1 ? 's are' : ' is'} checked, but none have a trailing number ` +
                `in their name (e.g. "..._1") to order by — got: ${sample}${checkedVisible.length > 3 ? ', …' : ''}.`
            )
            return
        }

        const checkedDev = devWallets.filter((w) => selectedReceivers.has(w.id))
        const includeDevCreationCost = checkedDev.length > 0
        const sequence = includeDevCreationCost
            ? [checkedDev[0], ...checkedTrading.map((x) => x.wallet)]
            : checkedTrading.map((x) => x.wallet)

        const parsedBufferPct = parseFloat(bufferPct)
        if (isNaN(parsedBufferPct) || parsedBufferPct < 0) {
            setBondingCurveMsg('Enter a buffer percentage of 0 or greater.')
            return
        }

        setBondingCurveLoading(true)
        try {
            const res = await fetch('/api/wallet/transfer/bonding-curve-funding', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ walletCount: sequence.length, includeDevCreationCost, bufferPct: parsedBufferPct }),
            })
            const data = await res.json()
            if (!res.ok) throw new Error(data.error ?? 'Calculation failed')

            const wallets: { bufferedSol: number }[] = data.wallets
            let totalBufferedSol = 0
            setReceiverAmounts((prev) => {
                const next = { ...prev }
                sequence.forEach((w, i) => {
                    if (wallets[i]) {
                        next[w.id] = wallets[i].bufferedSol.toFixed(9)
                        totalBufferedSol += wallets[i].bufferedSol
                    }
                })
                return next
            })

            const usd = formatUsd(totalBufferedSol, solUsdPrice)
            const extraDev = checkedDev.length > 1 ? ` (${checkedDev.length - 1} extra checked dev wallet${checkedDev.length - 1 !== 1 ? 's' : ''} left as-is — set manually)` : ''
            setBondingCurveMsg(
                `Filled ${sequence.length} wallet${sequence.length !== 1 ? 's' : ''} — ${totalBufferedSol.toFixed(4)} SOL total` +
                (usd ? ` (~${usd})` : '') +
                ` — 1% of supply each, sequential, +${parsedBufferPct}% buffer` +
                (includeDevCreationCost ? ', dev creation cost on the first wallet' : '') + `.${extraDev}`
            )
        } catch (err) {
            setBondingCurveMsg(err instanceof Error ? err.message : 'Calculation failed')
        } finally {
            setBondingCurveLoading(false)
        }
    }

    function openPreview() {
        setValidationError('')
        if (senderWalletIds.size === 0) { setValidationError('Select at least one sender wallet.'); return }
        if (selectedReceivers.size === 0) { setValidationError('Select at least one receiver wallet.'); return }

        const receivers = [...selectedReceivers].map((id) => {
            const wallet = wallets.find((w) => w.id === id)!
            return { wallet, amountSOL: parseFloat(receiverAmounts[id] ?? '') }
        })

        const missing = receivers.filter((r) => !r.amountSOL || r.amountSOL <= 0)
        if (missing.length > 0) {
            setValidationError(`Enter an amount greater than 0 for all selected wallets.`)
            return
        }

        const senders = [...senderWalletIds]
            .map((id) => wallets.find((w) => w.id === id))
            .filter((w): w is WalletRecord => !!w)

        setPreviewOpen(true)
        setPreviewPhase('calculating')
        setLegs([])
        setLegStatuses({})
        setDistributionWarning('')

        // Let the dialog paint the spinner before doing the (near-instant) computation.
        setTimeout(() => {
            const { legs: computed, totalNeededSol, totalCapacitySol } = computeBalancedFundingAssignment(senders, receivers)
            setLegs(computed)
            if (totalCapacitySol < totalNeededSol) {
                setDistributionWarning(
                    `Selected senders can only cover ~${totalCapacitySol.toFixed(4)} SOL of the ` +
                    `${totalNeededSol.toFixed(4)} SOL needed — some transfers below will likely fail.`
                )
            }
            setPreviewPhase('ready')
        }, 400)
    }

    function resetAfterTransfer() {
        setPreviewOpen(false)
        setPreviewPhase('calculating')
        setLegs([])
        setLegStatuses({})
        setDistributionWarning('')
        setSenderWalletIds(new Set())
        setSelectedReceivers(new Set())
        setReceiverAmounts({})
        setActiveFilters([])
        setBondingCurveMsg('')
    }

    async function sendLegBatch(senderWalletId: string, batch: FundingLeg[]) {
        try {
            const res = await fetch('/api/wallet/transfer/fund', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    senderWalletId,
                    receivers: batch.map((l) => ({
                        walletId:  l.receiverWalletId,
                        publicKey: l.receiverPublicKey,
                        amountSOL: l.amountSOL,
                    })),
                }),
            })
            if (res.ok) {
                const { results } = await res.json()
                const updates: Record<string, TransferStatus> = {}
                for (const r of results as { walletId: string; success: boolean }[]) {
                    updates[`${senderWalletId}:${r.walletId}`] = r.success ? 'success' : 'error'
                }
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

    async function executeDistributedTransfers() {
        setPreviewPhase('executing')

        const initial: Record<string, TransferStatus> = {}
        legs.forEach((l) => { initial[l.id] = 'loading' })
        setLegStatuses(initial)

        const bySender = new Map<string, FundingLeg[]>()
        legs.forEach((l) => {
            const arr = bySender.get(l.senderWalletId) ?? []
            arr.push(l)
            bySender.set(l.senderWalletId, arr)
        })

        // Independent senders/blockhash sequences — safe (and faster) to run in parallel.
        await Promise.all(
            Array.from(bySender.entries()).map(([senderWalletId, batch]) => sendLegBatch(senderWalletId, batch))
        )

        setPreviewPhase('done')
    }

    async function retryLeg(leg: FundingLeg) {
        setLegStatuses((prev) => ({ ...prev, [leg.id]: 'loading' }))
        await sendLegBatch(leg.senderWalletId, [leg])
    }

    const legsBySender = useMemo(() => {
        const map = new Map<string, FundingLeg[]>()
        legs.forEach((l) => {
            const arr = map.get(l.senderWalletId) ?? []
            arr.push(l)
            map.set(l.senderWalletId, arr)
        })
        return Array.from(map.values())
    }, [legs])

    function copyKey(e: React.MouseEvent, key: string, id: string) {
        e.stopPropagation()
        navigator.clipboard.writeText(key)
        setCopiedId(id)
        setTimeout(() => setCopiedId(null), 2000)
    }

    function renderGroupHeader(group: WalletGroup) {
        const allSelected  = group.wallets.every((w) => selectedReceivers.has(w.id))
        const someSelected = !allSelected && group.wallets.some((w) => selectedReceivers.has(w.id))
        return (
            <tr
                key={`group-${group.id}`}
                className="border-b bg-muted/50 cursor-pointer hover:bg-muted/70 transition-colors select-none"
                onClick={() => toggleGroup(group.wallets)}
            >
                <td colSpan={5} className="px-3 py-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
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
                        allSelected  ? 'border-blue-500 bg-blue-500'
                        : someSelected ? 'border-blue-400 bg-blue-400/30'
                        : 'border-muted-foreground/40 hover:border-blue-400',
                    ].join(' ')}>
                        {allSelected ? <Checkmark /> : someSelected ? <Dash /> : null}
                    </span>
                </td>
            </tr>
        )
    }

    let rowIndex = 0

    function renderRow(wallet: WalletRecord, n: number) {
        const checked = selectedReceivers.has(wallet.id)
        return (
            <tr
                key={wallet.id}
                onClick={() => toggleWallet(wallet.id)}
                className={[
                    'border-b cursor-pointer transition-colors',
                    checked ? 'bg-blue-500/5 hover:bg-blue-500/10' : 'hover:bg-muted/30',
                ].join(' ')}
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
                                        onKeyDown={(e) => e.key === 'Enter' && copyKey(e as never, wallet.public_key, wallet.id)}
                                        className="flex items-center justify-center rounded p-0.5 text-muted-foreground hover:text-foreground hover:bg-muted transition-colors cursor-pointer shrink-0"
                                        aria-label="Copy public key"
                                    >
                                        <Copy className="size-3" />
                                    </span>
                                </TooltipTrigger>
                                <TooltipContent side="top">
                                    {copiedId === wallet.id ? 'Copied to clipboard' : 'Copy address'}
                                </TooltipContent>
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
                <td className="px-3 py-2.5 text-xs text-muted-foreground">
                    {wallet.label ?? <span className="opacity-40">—</span>}
                </td>
                <td className="px-3 py-2.5 text-right text-muted-foreground tabular-nums text-xs">
                    {wallet.solana_balance_in_lamports
                        ? lamportsBNToSolDisplay(wallet.solana_balance_in_lamports)
                        : '—'}
                </td>
                <td className="px-3 py-2.5 text-right" onClick={(e) => e.stopPropagation()}>
                    <input
                        type="number"
                        min={0}
                        step={0.000000001}
                        placeholder="0.00"
                        value={receiverAmounts[wallet.id] ?? ''}
                        onChange={(e) => setReceiverAmounts((p) => ({ ...p, [wallet.id]: e.target.value }))}
                        className="w-24 rounded border border-input bg-transparent px-2 py-1 text-right text-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                    />
                </td>
                <td className="px-3 py-2.5 text-right">
                    <span
                        onClick={(e) => { e.stopPropagation(); toggleWallet(wallet.id) }}
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

    let devRowIndex = 0

    const totalSOL = [...selectedReceivers].reduce((sum, id) => {
        const v = parseFloat(receiverAmounts[id] ?? '')
        return sum + (isNaN(v) ? 0 : v)
    }, 0)

    return (
        <>
            <div className="flex flex-col gap-6">

                {/* Sender */}
                <div className="flex flex-col gap-1.5 max-w-sm">
                    <FieldLabel>Sender Wallet{senderWalletIds.size !== 1 ? 's' : ''}</FieldLabel>
                    <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                            <button
                                type="button"
                                className="flex h-9 w-full items-center justify-between rounded-md border border-input bg-transparent px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                            >
                                <span className={senderWalletIds.size === 0 ? 'text-muted-foreground' : 'truncate'}>
                                    {senderWalletIds.size === 0 && 'Select sender wallet(s)'}
                                    {senderWalletIds.size === 1 && (() => {
                                        const w = wallets.find((w) => w.id === [...senderWalletIds][0])
                                        if (!w) return null
                                        return (
                                            <>
                                                {w.label ? `${w.label} · ` : ''}
                                                {maskPubKey(w.public_key)}
                                                {w.solana_balance_in_lamports
                                                    ? ` · ${lamportsBNToSolDisplay(w.solana_balance_in_lamports)} SOL`
                                                    : ''}
                                            </>
                                        )
                                    })()}
                                    {senderWalletIds.size > 1 && `${senderWalletIds.size} wallets selected`}
                                </span>
                                <ChevronDown className="size-4 shrink-0 text-muted-foreground" />
                            </button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent className="max-h-80 w-(--radix-dropdown-menu-trigger-width) overflow-y-auto">
                            {senderGroups.map(([typeName, group], i) => (
                                <div key={typeName}>
                                    {i > 0 && <DropdownMenuSeparator />}
                                    <DropdownMenuLabel>{typeName}</DropdownMenuLabel>
                                    {group.map((w) => (
                                        <DropdownMenuCheckboxItem
                                            key={w.id}
                                            checked={senderWalletIds.has(w.id)}
                                            onSelect={(e) => e.preventDefault()}
                                            onCheckedChange={() => toggleSender(w.id)}
                                        >
                                            {w.label ? `${w.label} · ` : ''}
                                            {maskPubKey(w.public_key)}
                                            {w.solana_balance_in_lamports
                                                ? ` · ${lamportsBNToSolDisplay(w.solana_balance_in_lamports)} SOL`
                                                : ''}
                                        </DropdownMenuCheckboxItem>
                                    ))}
                                </div>
                            ))}
                        </DropdownMenuContent>
                    </DropdownMenu>
                    {senderWalletIds.size > 1 && (
                        <p className="text-xs text-muted-foreground">
                            Each receiver will be funded by exactly one of the {senderWalletIds.size} selected senders —
                            assigned to balance total load across them, not split across all of them.
                        </p>
                    )}
                </div>

                {/* Dev wallets — optional, surfaced separately for visibility */}
                {devWallets.length > 0 && (
                    <div className="flex flex-col gap-3">
                        <div className="flex items-center justify-between">
                            <FieldLabel>Dev Wallets</FieldLabel>
                            <span className="text-xs text-muted-foreground">Optional — skip if already funded</span>
                        </div>
                        <div className="w-full overflow-x-auto rounded-md border">
                            <table className="w-full text-sm border-collapse">
                                <thead className="bg-muted">
                                    <tr className="border-b text-xs font-medium uppercase tracking-wider text-muted-foreground">
                                        <th className="px-3 py-2.5 text-left w-10">#</th>
                                        <th className="px-3 py-2.5 text-left">Public Key</th>
                                        <th className="px-3 py-2.5 text-left">Label</th>
                                        <th className="px-3 py-2.5 text-right">SOL Balance</th>
                                        <th className="px-3 py-2.5 text-right">Amount (SOL)</th>
                                        <th className="px-3 py-2.5 text-right">Include</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {devWallets.map((wallet) => renderRow(wallet, ++devRowIndex))}
                                </tbody>
                            </table>
                        </div>
                    </div>
                )}

                {/* Funding strategy */}
                <div className="flex flex-col gap-2 rounded-lg border border-border bg-muted/20 p-4">
                    <div className="flex items-start justify-between gap-3">
                        <div className="flex flex-col gap-0.5">
                            <p className="text-sm font-medium">Bonding Curve Funding</p>
                            <p className="text-xs text-muted-foreground leading-relaxed">
                                Fills the Amount for each checked wallet below with what it needs to buy ~1% of
                                supply, walked sequentially down the curve, plus a buffer — ordered by each
                                wallet&apos;s trailing number (e.g. &quot;_1&quot;, &quot;_2&quot;). If a Dev
                                Wallet above is checked, it&apos;s funded first and also covers the token-creation cost.
                            </p>
                        </div>
                        <div className="flex flex-col items-end gap-2 shrink-0">
                            <div className="flex items-center gap-1.5">
                                <label htmlFor="bonding-curve-buffer" className="text-xs text-muted-foreground whitespace-nowrap">
                                    Buffer %
                                </label>
                                <input
                                    id="bonding-curve-buffer"
                                    type="number"
                                    min={0}
                                    step={1}
                                    value={bufferPct}
                                    onChange={(e) => setBufferPct(e.target.value)}
                                    className="w-16 rounded border border-input bg-background px-2 py-1 text-right text-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                                />
                            </div>
                            <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                onClick={applyBondingCurveFunding}
                                disabled={bondingCurveLoading}
                            >
                                {bondingCurveLoading ? 'Calculating…' : 'Calculate'}
                            </Button>
                        </div>
                    </div>
                    {bondingCurveMsg && (
                        <p className="text-xs text-muted-foreground">{bondingCurveMsg}</p>
                    )}
                </div>

                {/* Receiver table */}
                <div className="flex flex-col gap-3">
                    <FieldLabel>Receiver Wallets</FieldLabel>

                    {/* Type filter chips */}
                    <div className="flex flex-wrap gap-2">
                        <button
                            onClick={() => setActiveFilters([])}
                            className={[
                                'px-3 py-1 rounded-full text-xs font-medium border transition-colors',
                                activeFilters.length === 0
                                    ? 'bg-blue-500 border-blue-500 text-white'
                                    : 'border-border text-muted-foreground hover:border-blue-400 hover:text-foreground',
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
                                    activeFilters.includes(type.id)
                                        ? 'bg-blue-500 border-blue-500 text-white'
                                        : 'border-border text-muted-foreground hover:border-blue-400 hover:text-foreground',
                                ].join(' ')}
                            >
                                {type.name}
                            </button>
                        ))}
                    </div>

                    {/* Table */}
                    <div className="w-full overflow-x-auto overflow-y-auto max-h-[500px] rounded-md border">
                        <table className="w-full text-sm border-collapse">
                            <thead className="sticky top-0 z-10 bg-muted">
                                <tr className="border-b text-xs font-medium uppercase tracking-wider text-muted-foreground">
                                    <th className="px-3 py-2.5 text-left w-10">#</th>
                                    <th className="px-3 py-2.5 text-left">Public Key</th>
                                    <th className="px-3 py-2.5 text-left">Label</th>
                                    <th className="px-3 py-2.5 text-right">SOL Balance</th>
                                    <th className="px-3 py-2.5 text-right">Amount (SOL)</th>
                                    <th className="px-3 py-2.5 text-right">
                                        <div className="flex items-center justify-end gap-2">
                                            Include
                                            <span className="flex gap-1 normal-case tracking-normal font-normal">
                                                <button
                                                    onClick={selectAll}
                                                    className="text-[10px] border border-border rounded px-1.5 py-0.5 text-muted-foreground hover:text-blue-500 hover:border-blue-500 transition-colors"
                                                >
                                                    All
                                                </button>
                                                <button
                                                    onClick={clearAll}
                                                    className="text-[10px] border border-border rounded px-1.5 py-0.5 text-muted-foreground hover:text-destructive hover:border-destructive transition-colors"
                                                >
                                                    Clear
                                                </button>
                                            </span>
                                        </div>
                                    </th>
                                </tr>
                            </thead>
                            <tbody>
                                {walletGroups.map((group) => (
                                    <Fragment key={group.id}>
                                        {renderGroupHeader(group)}
                                        {group.wallets.map((wallet) => renderRow(wallet, ++rowIndex))}
                                    </Fragment>
                                ))}

                                {ungrouped.length > 0 && (
                                    <Fragment>
                                        {walletGroups.length > 0 && (
                                            <tr className="border-b bg-muted/30">
                                                <td colSpan={6} className="px-3 py-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground/60">
                                                    Ungrouped
                                                </td>
                                            </tr>
                                        )}
                                        {ungrouped.map((wallet) => renderRow(wallet, ++rowIndex))}
                                    </Fragment>
                                )}

                                {visibleWallets.length === 0 && (
                                    <tr>
                                        <td colSpan={6} className="px-3 py-6 text-center text-sm text-muted-foreground">
                                            {senderWalletIds.size > 0 ? 'No other wallets found.' : 'Select a sender wallet to see receivers.'}
                                        </td>
                                    </tr>
                                )}
                            </tbody>
                        </table>
                    </div>

                    {selectedReceivers.size > 0 && (
                        <div className="flex items-center justify-between text-xs text-muted-foreground">
                            <span>{selectedReceivers.size} wallet{selectedReceivers.size !== 1 ? 's' : ''} selected</span>
                            {totalSOL > 0 && (
                                <span>
                                    Total: {totalSOL.toFixed(9)} SOL
                                    {formatUsd(totalSOL, solUsdPrice) && ` (~${formatUsd(totalSOL, solUsdPrice)})`}
                                </span>
                            )}
                        </div>
                    )}
                </div>

                {/* Validation error */}
                {validationError && (
                    <p className="text-sm text-destructive">{validationError}</p>
                )}

                {/* Submit */}
                <Button size="lg" variant="default" onClick={openPreview}>
                    Preview
                </Button>
            </div>

            {/* Distribution preview / execution dialog */}
            <Dialog
                open={previewOpen}
                onOpenChange={(open) => {
                    if (open) return
                    if (previewPhase === 'calculating' || previewPhase === 'executing') return // block closing mid-flight
                    if (previewPhase === 'done') resetAfterTransfer()
                    else setPreviewOpen(false)
                }}
            >
                <DialogContent className="max-w-lg">
                    <DialogHeader>
                        <DialogTitle>
                            {previewPhase === 'calculating' && 'Calculating Distribution…'}
                            {previewPhase === 'ready' && 'Preview Distribution'}
                            {previewPhase === 'executing' && 'Sending Transfers…'}
                            {previewPhase === 'done' && 'Transfers Complete'}
                        </DialogTitle>
                        <DialogDescription>
                            {previewPhase === 'calculating'
                                ? 'Splitting funding evenly across the selected sender wallets…'
                                : `${legsBySender.length} sender${legsBySender.length !== 1 ? 's' : ''} → ${new Set(legs.map((l) => l.receiverWalletId)).size} receiver${new Set(legs.map((l) => l.receiverWalletId)).size !== 1 ? 's' : ''}, ${legs.length} transfer${legs.length !== 1 ? 's' : ''} total`}
                        </DialogDescription>
                    </DialogHeader>

                    {previewPhase === 'calculating' && (
                        <div className="flex flex-col items-center gap-3 py-10 text-muted-foreground">
                            <span className="size-8 animate-spin rounded-full border-2 border-blue-500 border-t-transparent" />
                            <p className="text-sm">Calculating distribution…</p>
                        </div>
                    )}

                    {previewPhase !== 'calculating' && (
                        <>
                            {distributionWarning && (
                                <p className="text-xs text-destructive">{distributionWarning}</p>
                            )}

                            <div className="flex flex-col gap-4 max-h-[420px] overflow-y-auto pr-1">
                                {legsBySender.map((senderLegs) => {
                                    const subtotal = senderLegs.reduce((s, l) => s + l.amountSOL, 0)
                                    return (
                                        <div key={senderLegs[0].senderWalletId} className="flex flex-col gap-1.5">
                                            <div className="flex items-center justify-between border-b pb-1">
                                                <span className="text-xs font-semibold text-foreground truncate">
                                                    {senderLegs[0].senderLabel ? `${senderLegs[0].senderLabel} · ` : ''}
                                                    {maskPubKey(senderLegs[0].senderPublicKey)}
                                                </span>
                                                <span className="text-xs text-muted-foreground tabular-nums shrink-0">
                                                    {subtotal.toFixed(9)} SOL
                                                </span>
                                            </div>
                                            <div className="flex flex-col divide-y">
                                                {senderLegs.map((leg) => {
                                                    const status = legStatuses[leg.id] ?? 'pending'
                                                    return (
                                                        <div key={leg.id} className="flex items-center gap-2 py-1.5">
                                                            {previewPhase !== 'ready' && (
                                                                <div className="size-4 shrink-0 flex items-center justify-center">
                                                                    {status === 'pending' && (
                                                                        <span className="size-2 rounded-full bg-muted-foreground/30" />
                                                                    )}
                                                                    {status === 'loading' && (
                                                                        <span className="size-3.5 animate-spin rounded-full border-2 border-blue-500 border-t-transparent" />
                                                                    )}
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
                                                                {leg.receiverLabel ? `${leg.receiverLabel} · ` : ''}{maskPubKey(leg.receiverPublicKey)}
                                                            </span>
                                                            <span className="text-xs font-semibold tabular-nums shrink-0">
                                                                {leg.amountSOL.toFixed(9)} SOL
                                                            </span>
                                                            {status === 'error' && (
                                                                <Button
                                                                    size="sm"
                                                                    variant="outline"
                                                                    className="h-6 shrink-0 px-2 text-[10px]"
                                                                    onClick={() => retryLeg(leg)}
                                                                >
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
                                    {legs.reduce((s, l) => s + l.amountSOL, 0).toFixed(9)} SOL
                                    {formatUsd(legs.reduce((s, l) => s + l.amountSOL, 0), solUsdPrice) && (
                                        <span className="block text-xs font-normal text-muted-foreground">
                                            ~{formatUsd(legs.reduce((s, l) => s + l.amountSOL, 0), solUsdPrice)}
                                        </span>
                                    )}
                                </span>
                            </div>
                        </>
                    )}

                    {previewPhase === 'ready' && (
                        <DialogFooter>
                            <DialogClose asChild>
                                <Button variant="outline">Cancel</Button>
                            </DialogClose>
                            <Button variant="default" onClick={executeDistributedTransfers}>
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
                                    failed === 0
                                        ? 'bg-green-500/10 text-green-700 dark:text-green-400'
                                        : 'bg-destructive/10 text-destructive',
                                ].join(' ')}>
                                    {failed === 0
                                        ? `All ${success} transfer${success !== 1 ? 's' : ''} submitted successfully.`
                                        : `${success} succeeded, ${failed} failed — retry the failed ones above or close to finish.`}
                                </div>
                                <DialogFooter>
                                    <Button variant="default" onClick={resetAfterTransfer}>Done</Button>
                                </DialogFooter>
                            </>
                        )
                    })()}
                </DialogContent>
            </Dialog>
        </>
    )
}
