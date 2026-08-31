'use client'

import { useState, useEffect } from 'react'
import type { Node, Edge } from '@xyflow/react'
import BN from 'bn.js'
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogDescription,
    DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
    DropdownMenu,
    DropdownMenuTrigger,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuGroup,
} from '@/components/ui/dropdown-menu'
import { ChevronDown } from 'lucide-react'
import LaunchTokenSelect from '@/components/tokens/launch/launch-token-select'
import LaunchBuyerConfig from '@/components/tokens/launch/launch-buyer-config'
import { LaunchConfig } from '@/components/tokens/launch/launch-config-class'
import { LaunchType } from '@/components/tokens/launch/types'
import { TokenMint } from '@/lib/types/token-mint'
import { WalletTradeDTO, WalletRecord } from '@/lib/types/wallet'
import type { LookupTable } from '@/lib/types/lookup-table'
import { solStringToLamports } from '@/lib/lamports'
import StrategyWalletSelector from '@/components/trade/strategy-trade/strategy-wallet-selector'
import { SlippageControl } from '@/components/trade/trade/SlippageControl'
import { BuilderNodeData, LaunchTypeSubtype, TradeSubtype, TriggerSubtype, ConditionalSubtype, UtilitySubtype, ParsedBundledWallet } from './types'
import { PALETTE_ITEMS } from './node-palette-config'
import { findTokenNodeData, collectAvailableVariables } from './handle-types'

type Props = {
    node: Node | null
    nodes: Node[]
    edges: Edge[]
    onOpenChange: (open: boolean) => void
    onSave: (nodeId: string, config: Record<string, unknown>) => void
    /** Test Mode — relaxes the Token node's picker to allow already-launched tokens, needed to test Trade nodes against a real bonding curve. */
    testMode: boolean
}

export default function NodeConfigDialog({ node, nodes, edges, onOpenChange, onSave, testMode }: Props) {
    const data = node?.data as unknown as BuilderNodeData | undefined

    return (
        <Dialog open={!!node} onOpenChange={onOpenChange}>
            <DialogContent className="w-[95vw] sm:max-w-5xl">
                {node && data && (
                    <ConfigBody
                        key={node.id}
                        nodeId={node.id}
                        data={data}
                        nodes={nodes}
                        edges={edges}
                        onSave={onSave}
                        onClose={() => onOpenChange(false)}
                        testMode={testMode}
                    />
                )}
            </DialogContent>
        </Dialog>
    )
}

function ConfigBody({
    nodeId,
    data,
    nodes,
    edges,
    onSave,
    onClose,
    testMode,
}: {
    nodeId: string
    data: BuilderNodeData
    nodes: Node[]
    edges: Edge[]
    onSave: Props['onSave']
    onClose: () => void
    testMode: boolean
}) {
    const [config, setConfig] = useState<Record<string, unknown>>({ ...data.config })
    const def = PALETTE_ITEMS.find((i) => i.subtype === data.subtype)

    function patch(p: Record<string, unknown>) {
        setConfig((prev) => ({ ...prev, ...p }))
    }

    function handleSave() {
        onSave(nodeId, config)
        onClose()
    }

    return (
        <>
            <DialogHeader>
                <DialogTitle>{def?.label ?? data.label}</DialogTitle>
                <DialogDescription>{def?.description}</DialogDescription>
            </DialogHeader>

            <div className="max-h-[65vh] overflow-y-auto pr-1">
                {data.category === 'execution' && (
                    <p className="text-xs text-muted-foreground">
                        No configuration needed. Drag a connection from this node&apos;s bottom handle to the
                        lime pin on the left edge of any node to make that node the entry point when you
                        run this graph manually.
                    </p>
                )}

                {data.category === 'token' && (
                    <LaunchTokenSelect
                        selectedId={(config.tokenId as string) ?? null}
                        onSelect={(token) =>
                            patch({
                                tokenId: token.id,
                                tokenName: token.token_name,
                                tokenSymbol: token.token_symbol,
                                tokenMint: token.mint_public_key,
                                devWalletId: token.dev_wallet_id,
                            })
                        }
                        onClear={() =>
                            patch({
                                tokenId: undefined,
                                tokenName: undefined,
                                tokenSymbol: undefined,
                                tokenMint: undefined,
                                devWalletId: undefined,
                            })
                        }
                        allowLaunched={testMode}
                    />
                )}

                {data.category === 'launchType' && (
                    <LaunchTypeFields
                        subtype={data.subtype as LaunchTypeSubtype}
                        config={config}
                        patch={patch}
                        nodeId={nodeId}
                        nodes={nodes}
                        edges={edges}
                    />
                )}

                {data.category === 'trade' && (
                    <TradeFields
                        subtype={data.subtype as TradeSubtype}
                        config={config}
                        patch={patch}
                        nodeId={nodeId}
                        nodes={nodes}
                        edges={edges}
                    />
                )}

                {data.category === 'trigger' && (
                    <TriggerFields subtype={data.subtype as TriggerSubtype} config={config} patch={patch} />
                )}

                {data.category === 'conditional' && (
                    <ConditionalFields subtype={data.subtype as ConditionalSubtype} config={config} patch={patch} />
                )}

                {data.category === 'utility' && (
                    <UtilityFields
                        subtype={data.subtype as UtilitySubtype}
                        config={config}
                        patch={patch}
                        nodeId={nodeId}
                        nodes={nodes}
                        edges={edges}
                    />
                )}
            </div>

            <DialogFooter>
                <Button variant="outline" onClick={onClose}>Cancel</Button>
                <Button onClick={handleSave}>Save</Button>
            </DialogFooter>
        </>
    )
}

// ── Launch Type ──────────────────────────────────────────────────────────

type SerializedWalletTrade = ReturnType<LaunchConfig['toJSON']>['walletTrades'][number]

function deserializeWalletTrades(raw: unknown): WalletTradeDTO[] {
    const trades = (raw as SerializedWalletTrade[] | undefined) ?? []
    const deserialized = trades.map((t) => ({
        walletId: t.walletId,
        tradeType: t.tradeType,
        buyAmountInSOL: new BN(t.buyAmountInSOL),
        tokensAmountHeld: t.tokensAmountHeld != null ? new BN(t.tokensAmountHeld) : null,
        percentOfSupplyHeld: t.percentOfSupplyHeld != null ? new BN(t.percentOfSupplyHeld) : null,
        marketCapAtBuy: t.marketCapAtBuy != null ? new BN(t.marketCapAtBuy) : null,
    }))
    // Self-heals configs saved while LaunchConfig's old mutate-in-place bug could
    // duplicate an entry — collapse to one trade per wallet, keeping the last
    // (most recently entered) amount for that wallet.
    const byWalletId = new Map<string, WalletTradeDTO>()
    for (const trade of deserialized) byWalletId.set(trade.walletId, trade)
    return Array.from(byWalletId.values())
}

function LaunchTypeFields({
    subtype,
    config,
    patch,
    nodeId,
    nodes,
    edges,
}: {
    subtype: LaunchTypeSubtype
    config: Record<string, unknown>
    patch: (p: Record<string, unknown>) => void
    nodeId: string
    nodes: Node[]
    edges: Edge[]
}) {
    const devOnly    = subtype === 'dev0DevOnly'
    const devBundle  = subtype === 'dev0DevBundle'

    const tokenNodeData = findTokenNodeData(nodeId, nodes, edges)
    const devWalletId = (tokenNodeData?.config.devWalletId as string | null | undefined) ?? null

    // Jito bundles cap at 5 transactions — tx #1 is create+dev-buy, so at most
    // 4 more wallets can join. Mirrors MAX_BUNDLE_WALLETS in the launch route.
    const MAX_BUNDLE_WALLETS = 5
    const [jitoTipSol, setJitoTipSol] = useState<string>((config.jitoTipSol as string) ?? '0.001')
    const [slippage, setSlippage]     = useState<number>((config.slippage as number) ?? 0.05)

    function updateJitoTip(v: string) {
        setJitoTipSol(v)
        patch({ jitoTipSol: v })
    }

    function updateSlippage(v: number) {
        setSlippage(v)
        patch({ slippage: v })
    }

    const [launchConfig, setLaunchConfig] = useState<LaunchConfig>(
        () => {
            const allTrades = deserializeWalletTrades(config.walletTrades)
            // "Dev 0 (Dev Only)" can only ever hold the dev wallet's own buy — the
            // config UI can't add anyone else while devOnly is true, but a config
            // saved before this node's data was properly scoped could still carry
            // an extra non-dev entry (e.g. from an earlier, differently-configured
            // save). Strip anything that isn't the dev wallet on load so old data
            // self-heals instead of silently showing/spending on a second buyer.
            const walletTrades = devOnly
                ? allTrades.filter((t) => t.walletId === devWalletId)
                : allTrades
            return new LaunchConfig(
                LaunchType.unselected,
                // LaunchBuyerConfig only reads `token.dev_wallet_id` — a partial stand-in is fine here.
                devWalletId ? ({ dev_wallet_id: devWalletId } as unknown as TokenMint) : null,
                LaunchConfig.sumBuyAmounts(walletTrades),
                new BN(0),
                new BN(0),
                new BN(0),
                walletTrades,
            )
        },
    )

    // If the load-time filter above actually stripped a stale non-dev entry,
    // push the corrected wallet list into the node's config immediately — so
    // the fix takes effect (node card's "N buyers" label, next Save) just from
    // opening this dialog, not only after the user happens to edit something.
    useEffect(() => {
        const rawCount = (deserializeWalletTrades(config.walletTrades)).length
        if (devOnly && rawCount !== launchConfig.walletTrades.length) {
            const json = launchConfig.toJSON()
            patch({ walletTrades: json.walletTrades, totalSOLInLamports: json.totalSOLInLamports })
        }
        // Only ever needs to run once, right after mount — deps intentionally omitted.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])

    function persist(next: LaunchConfig) {
        setLaunchConfig(next)
        const json = next.toJSON()
        patch({ walletTrades: json.walletTrades, totalSOLInLamports: json.totalSOLInLamports })
    }

    function onBuyInputChange(walletId: string, newAmount: string) {
        const newAmountInLamports = newAmount === '' || newAmount === '.' ? new BN(0) : solStringToLamports(newAmount)
        persist(launchConfig.updateWalletList(walletId, newAmountInLamports, 'buy'))
    }

    function onBuyInputReset() {
        persist(launchConfig.clearWalletList())
    }

    const walletCount     = launchConfig.walletTrades.length
    const overBundleLimit = devBundle && walletCount > MAX_BUNDLE_WALLETS
    const missingDevBuy   = devBundle && walletCount > 0 && devWalletId != null
        && !launchConfig.walletTrades.some((t) => t.walletId === devWalletId)

    return (
        <div className="flex flex-col gap-3">
            {!devWalletId && (
                <p className="text-xs text-muted-foreground">
                    No token selected yet — add a Token node and select a token to{' '}
                    {devOnly ? 'configure its dev wallet buy here.' : 'highlight its dev wallet here.'}
                </p>
            )}

            {devBundle && (
                <>
                    <p className="text-xs text-muted-foreground">
                        Create + dev buy lands as transaction #1 of one atomic Jito bundle — add up to{' '}
                        {MAX_BUNDLE_WALLETS - 1} more wallets below and they buy alongside it in the same
                        bundle, so nothing can be sniped in between.
                    </p>
                    <div className="flex flex-wrap items-end gap-4">
                        <div className="flex flex-col gap-1.5">
                            <Label className="text-xs text-muted-foreground whitespace-nowrap">Jito Tip (SOL)</Label>
                            <Input
                                type="number"
                                min={0}
                                step={0.0001}
                                value={jitoTipSol}
                                onChange={(e) => updateJitoTip(e.target.value)}
                                className="w-28"
                            />
                        </div>
                    </div>
                    <SlippageControl value={slippage} onChange={updateSlippage} />
                    {overBundleLimit && (
                        <p className="text-xs text-destructive">
                            {walletCount} wallets selected — at most {MAX_BUNDLE_WALLETS} (dev + {MAX_BUNDLE_WALLETS - 1}) can buy in one launch bundle.
                        </p>
                    )}
                    {missingDevBuy && (
                        <p className="text-xs text-destructive">
                            The dev wallet needs its own buy amount set — it must be one of the buyers in a bundled launch.
                        </p>
                    )}
                </>
            )}

            <LaunchBuyerConfig
                launchConfig={launchConfig}
                onBuyInputChange={onBuyInputChange}
                onBuyInputReset={onBuyInputReset}
                devOnly={devOnly}
            />
        </div>
    )
}

// ── Trade ────────────────────────────────────────────────────────────────

function TradeFields({
    subtype,
    config,
    patch,
    nodeId,
    nodes,
    edges,
}: {
    subtype: TradeSubtype
    config: Record<string, unknown>
    patch: (p: Record<string, unknown>) => void
    nodeId: string
    nodes: Node[]
    edges: Edge[]
}) {
    const [selectedWalletIds, setSelectedWalletIds] = useState<Set<string>>(
        new Set((config.selectedWalletIds as string[]) ?? []),
    )
    const [tradeAmounts, setTradeAmounts] = useState<Record<string, string>>(
        (config.tradeAmounts as Record<string, string>) ?? {},
    )
    const [slippage, setSlippage] = useState<number>((config.slippage as number) ?? 0.05)

    const tokenNodeData = findTokenNodeData(nodeId, nodes, edges)
    const tokenName   = (tokenNodeData?.config.tokenName   as string | undefined) ?? null
    const tokenSymbol = (tokenNodeData?.config.tokenSymbol as string | undefined) ?? null
    const tokenMint   = (tokenNodeData?.config.tokenMint   as string | undefined) ?? null
    const isSellSubtype = subtype === 'staggeredSell' || subtype === 'sellPercent' || subtype === 'sellAll'

    function updateWallets(ids: Set<string>) {
        setSelectedWalletIds(ids)
        patch({ selectedWalletIds: Array.from(ids) })
    }

    function updateAmount(id: string, amount: string) {
        const next = { ...tradeAmounts, [id]: amount }
        setTradeAmounts(next)
        patch({ tradeAmounts: next })
    }

    function resetAmounts() {
        setTradeAmounts({})
        patch({ tradeAmounts: {} })
    }

    function updateSlippage(v: number) {
        setSlippage(v)
        patch({ slippage: v })
    }

    return (
        <div className="flex flex-col gap-6">
            {/* Token — read-only, sourced from the Token node */}
            <div className="flex flex-col gap-1.5">
                <Label className="text-xs">Token</Label>
                {tokenMint ? (
                    <div className="flex items-center gap-2 rounded-md border border-border bg-muted/30 px-3 py-2">
                        <span className="text-sm font-medium">{tokenName ?? tokenMint}</span>
                        {tokenSymbol && (
                            <span className="text-xs text-muted-foreground">{tokenSymbol}</span>
                        )}
                        <span className="ml-auto font-mono text-[10px] text-muted-foreground">
                            {tokenMint.slice(0, 6)}…{tokenMint.slice(-4)}
                        </span>
                    </div>
                ) : (
                    <p className="text-xs text-muted-foreground">
                        Add a Token node and select a token — it will appear here automatically.
                    </p>
                )}
            </div>

            {(subtype === 'staggeredBuy' || subtype === 'staggeredSell') && (
                <StaggerDelayInputs config={config} patch={patch} />
            )}

            {(subtype === 'staggeredSell' || subtype === 'sellPercent') && (
                <StaggeredSellFields config={config} patch={patch} />
            )}

            {subtype === 'sellAll' && (
                <div className="flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/5 px-3 py-2.5">
                    <span className="mt-0.5 shrink-0 text-amber-400">⚠</span>
                    <p className="text-xs text-amber-300/80">
                        Sells each selected wallet&apos;s entire live token balance atomically in a single Jito bundle —
                        no percentage to set, no stagger delay, and up to 10 wallets per run.
                    </p>
                </div>
            )}

            {subtype === 'humanVolume' && (
                <div className="flex w-40 flex-col gap-1.5">
                    <Label className="text-xs">Duration (minutes)</Label>
                    <Input
                        type="number" min={1}
                        value={(config.durationMinutes as string) ?? '30'}
                        onChange={(e) => patch({ durationMinutes: e.target.value })}
                    />
                </div>
            )}

            {subtype === 'trendingVolume' && (
                <div className="flex w-40 flex-col gap-1.5">
                    <Label className="text-xs">Target Volume (SOL)</Label>
                    <Input
                        type="number" min={0}
                        value={(config.targetVolumeSol as string) ?? ''}
                        onChange={(e) => patch({ targetVolumeSol: e.target.value })}
                    />
                </div>
            )}

            {subtype === 'holdersMaker' && (
                <div className="flex w-40 flex-col gap-1.5">
                    <Label className="text-xs">Target Holder Count</Label>
                    <Input
                        type="number" min={1}
                        value={(config.targetHolderCount as string) ?? ''}
                        onChange={(e) => patch({ targetHolderCount: e.target.value })}
                    />
                </div>
            )}

            {subtype !== 'bundledJito' && (
                <SlippageControl value={slippage} onChange={updateSlippage} />
            )}

            {subtype === 'bundledJito' ? (
                <BundledJitoWalletsInput
                    config={config}
                    patch={patch}
                    slippage={slippage}
                    onSlippageChange={updateSlippage}
                    tokenId={(tokenNodeData?.config.tokenId as string | undefined) ?? null}
                    devWalletId={(tokenNodeData?.config.devWalletId as string | undefined) ?? null}
                />
            ) : (
                <StrategyWalletSelector
                    selectedIds={selectedWalletIds}
                    onSelectionChange={updateWallets}
                    onTradeAmountChange={updateAmount}
                    onTradeAmountReset={resetAmounts}
                    tradeAmounts={tradeAmounts}
                    defaultTypeName="Trader"
                    tradeType={isSellSubtype ? 'sell' : 'buy'}
                    tokenMint={isSellSubtype ? (tokenMint ?? undefined) : undefined}
                    hideTradeAmountColumn={subtype === 'sellPercent' || subtype === 'sellAll'}
                />
            )}
        </div>
    )
}

/**
 * Bundled Jito trade's wallet source: paste the "Copy Launch Totals" JSON built
 * by the Fund Launch Wallets bonding-curve panel, parse its `wallets` array
 * (already in sequential launch order), and resolve each entry's public key
 * against the live wallet list to get the internal wallet id trades execute
 * with. `bundleSize` is how many wallets the eventual loop packs into each
 * Jito bundle submission.
 */
function BundledJitoWalletsInput({
    config,
    patch,
    slippage,
    onSlippageChange,
    tokenId,
    devWalletId,
}: {
    config: Record<string, unknown>
    patch: (p: Record<string, unknown>) => void
    slippage: number
    onSlippageChange: (v: number) => void
    tokenId: string | null
    devWalletId: string | null
}) {
    const [jsonText, setJsonText]     = useState<string>((config.bundledSourceJson as string) ?? '')
    const [parseError, setParseError] = useState('')
    const [wallets, setWallets]       = useState<ParsedBundledWallet[]>((config.bundledWallets as ParsedBundledWallet[]) ?? [])
    const [bundleSize, setBundleSize] = useState<number>((config.bundleSize as number) ?? 5)
    const [jitoTipSol, setJitoTipSol] = useState<string>((config.jitoTipSol as string) ?? '0.001')

    const [liveWallets, setLiveWallets]             = useState<WalletRecord[]>([])
    const [liveWalletsLoading, setLiveWalletsLoading] = useState(true)

    useEffect(() => {
        fetch('/api/wallets/explorer')
            .then((r) => r.ok ? r.json() : null)
            .then((data) => { if (data) setLiveWallets(data.wallets ?? []) })
            .catch(() => {})
            .finally(() => setLiveWalletsLoading(false))
    }, [])

    function resolveWalletIds(list: ParsedBundledWallet[], live: WalletRecord[]): ParsedBundledWallet[] {
        const byPublicKey = new Map(live.map((w) => [w.public_key, w.id]))
        return list.map((w) => ({ ...w, walletId: byPublicKey.get(w.publicKey) ?? null }))
    }

    function parseAndResolve(text: string) {
        setJsonText(text)
        patch({ bundledSourceJson: text })
        setParseError('')

        if (!text.trim()) {
            setWallets([])
            patch({ bundledWallets: [] })
            return
        }

        let parsed: unknown
        try {
            parsed = JSON.parse(text)
        } catch {
            setParseError('Invalid JSON.')
            return
        }

        const rawWallets = (parsed as { wallets?: unknown })?.wallets
        if (!Array.isArray(rawWallets)) {
            setParseError('No "wallets" array found in the pasted JSON.')
            return
        }

        const unresolved: ParsedBundledWallet[] = rawWallets.map((w) => {
            const rw = w as Record<string, unknown>
            return {
                label:         typeof rw.label === 'string' ? rw.label : null,
                publicKey:     typeof rw.publicKey === 'string' ? rw.publicKey : '',
                buyAmountSol:  typeof rw.buyAmountSol === 'number' ? rw.buyAmountSol : Number(rw.buyAmountSol) || 0,
                fundAmountSol: typeof rw.fundAmountSol === 'number' ? rw.fundAmountSol : null,
                walletId:      null,
            }
        })

        const resolved = resolveWalletIds(unresolved, liveWallets)
        setWallets(resolved)
        patch({ bundledWallets: resolved })
    }

    // Live wallet list can arrive after a paste that already happened — re-resolve once it lands.
    useEffect(() => {
        if (liveWallets.length === 0 || wallets.length === 0) return
        const reresolved = resolveWalletIds(wallets, liveWallets)
        if (reresolved.some((w, i) => w.walletId !== wallets[i].walletId)) {
            setWallets(reresolved)
            patch({ bundledWallets: reresolved })
        }
        // Only re-run when the live wallet list changes — re-resolving on every `wallets` write would loop.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [liveWallets])

    function updateBundleSize(v: number) {
        const clamped = Math.min(10, Math.max(1, v))
        setBundleSize(clamped)
        patch({ bundleSize: clamped })
    }

    function updateJitoTip(v: string) {
        setJitoTipSol(v)
        patch({ jitoTipSol: v })
    }

    const unmatchedCount = wallets.filter((w) => !w.walletId).length
    const totalBuySol    = wallets.reduce((s, w) => s + w.buyAmountSol, 0)
    const bundleCount     = bundleSize > 0 ? Math.ceil(wallets.length / bundleSize) : 0

    return (
        <div className="flex flex-col gap-3">
            <div className="flex flex-wrap items-end gap-4">
                <div className="flex flex-col gap-1.5">
                    <Label className="text-xs text-muted-foreground whitespace-nowrap">Wallets per bundle</Label>
                    <Input
                        type="number"
                        min={1}
                        max={10}
                        value={bundleSize}
                        onChange={(e) => updateBundleSize(Number(e.target.value) || 1)}
                        className="w-24"
                    />
                </div>
                <div className="flex flex-col gap-1.5">
                    <Label className="text-xs text-muted-foreground whitespace-nowrap">Jito Tip (SOL)</Label>
                    <Input
                        type="number"
                        min={0}
                        step={0.0001}
                        value={jitoTipSol}
                        onChange={(e) => updateJitoTip(e.target.value)}
                        className="w-28"
                    />
                </div>
            </div>

            <SlippageControl value={slippage} onChange={onSlippageChange} />

            <Label className="text-xs">Launch Totals JSON</Label>
            <Textarea
                rows={6}
                placeholder='Paste the "Copy Launch Totals" JSON here…'
                value={jsonText}
                onChange={(e) => parseAndResolve(e.target.value)}
                className="font-mono text-xs"
            />

            {parseError && <p className="text-xs text-destructive">{parseError}</p>}

            {wallets.length > 0 && !parseError && (
                <div className="flex flex-col gap-2">
                    <p className="text-xs text-muted-foreground">
                        {wallets.length} wallet{wallets.length !== 1 ? 's' : ''} parsed, {totalBuySol.toFixed(4)} SOL total buy —{' '}
                        {bundleCount} bundle{bundleCount !== 1 ? 's' : ''} of up to {bundleSize}
                        {liveWalletsLoading
                            ? ' · matching against live wallets…'
                            : unmatchedCount > 0
                            ? ` · ${unmatchedCount} not found in wallet list`
                            : ' · all matched'}
                    </p>

                    <div className="max-h-56 overflow-y-auto rounded-md border">
                        <table className="w-full text-xs border-collapse">
                            <thead className="sticky top-0 bg-muted">
                                <tr className="border-b text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                                    <th className="px-2 py-1.5 text-left w-10">#</th>
                                    <th className="px-2 py-1.5 text-left">Wallet</th>
                                    <th className="px-2 py-1.5 text-right">Buy (SOL)</th>
                                    <th className="px-2 py-1.5 text-right">Bundle</th>
                                </tr>
                            </thead>
                            <tbody>
                                {wallets.map((w, i) => (
                                    <tr
                                        key={`${w.publicKey || 'wallet'}-${i}`}
                                        className={['border-b', !w.walletId && !liveWalletsLoading ? 'bg-destructive/5' : ''].join(' ')}
                                    >
                                        <td className="px-2 py-1.5 text-muted-foreground tabular-nums">{i + 1}</td>
                                        <td className="px-2 py-1.5">
                                            <span className="font-medium">{w.label ?? '—'}</span>{' '}
                                            <span className="font-mono text-muted-foreground">
                                                {w.publicKey ? `${w.publicKey.slice(0, 5)}…${w.publicKey.slice(-5)}` : '—'}
                                            </span>
                                            {!w.walletId && !liveWalletsLoading && (
                                                <span className="ml-1.5 text-[10px] text-destructive">not found</span>
                                            )}
                                        </td>
                                        <td className="px-2 py-1.5 text-right tabular-nums">{w.buyAmountSol.toFixed(4)}</td>
                                        <td className="px-2 py-1.5 text-right tabular-nums text-muted-foreground">
                                            #{Math.floor(i / bundleSize) + 1}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}

            <MintAltSection
                tokenId={tokenId}
                devWalletId={devWalletId}
                walletIds={wallets.filter((w): w is ParsedBundledWallet & { walletId: string } => !!w.walletId).map((w) => w.walletId)}
            />
        </div>
    )
}

/**
 * Checks for (and can build) a dedicated per-mint Address Lookup Table —
 * shared pump.fun accounts + every target wallet's ATA, built via
 * POST /api/lookup-table/mint-alt. Bundle buy/sell routes pick this up
 * automatically by mint once it exists (lib/lookup-table/resolve-mint-alt.ts) —
 * this is purely a build/status UI, there's no "use it" toggle since a mint
 * with no table just falls back to the previous (unoptimized) behavior.
 */
function MintAltSection({
    tokenId,
    devWalletId,
    walletIds,
}: {
    tokenId:     string | null
    devWalletId: string | null
    walletIds:   string[]
}) {
    const [status, setStatus]     = useState<'checking' | 'none' | 'active'>('checking')
    const [table, setTable]       = useState<LookupTable | null>(null)
    const [building, setBuilding] = useState(false)
    const [error, setError]       = useState('')

    useEffect(() => {
        if (!tokenId) {
            setStatus('none')
            setTable(null)
            return
        }
        setStatus('checking')
        fetch(`/api/lookup-table?mintId=${encodeURIComponent(tokenId)}`)
            .then((r) => (r.ok ? r.json() : null))
            .then((data) => {
                const active = (data?.tables as LookupTable[] | undefined)?.find((t) => t.status === 'active')
                setTable(active ?? null)
                setStatus(active ? 'active' : 'none')
            })
            .catch(() => setStatus('none'))
    }, [tokenId])

    async function build() {
        if (!tokenId || !devWalletId || walletIds.length === 0) return
        setBuilding(true)
        setError('')
        try {
            const res = await fetch('/api/lookup-table/mint-alt', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    mintId:            tokenId,
                    walletIds,
                    authorityWalletId: devWalletId,
                }),
            })
            const result = await res.json()
            if (!res.ok) throw new Error(result.error ?? 'ALT build failed')
            setTable({
                id:             result.id as string,
                public_address: result.altAddress as string,
                address_count:  result.addressCount as number,
                status:         'active',
            } as LookupTable)
            setStatus('active')
        } catch (err) {
            setError(err instanceof Error ? err.message : String(err))
        } finally {
            setBuilding(false)
        }
    }

    if (!tokenId) {
        return (
            <p className="text-xs text-muted-foreground">
                Add a Token node to enable building a lookup table for this launch.
            </p>
        )
    }

    return (
        <div className="flex flex-col gap-2 rounded-md border border-border bg-muted/20 px-3 py-2.5">
            <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                    <p className="text-xs font-medium">Address Lookup Table</p>
                    <p className="text-[11px] text-muted-foreground">
                        {status === 'checking' && 'Checking for an existing table…'}
                        {status === 'active' && table && `Active — ${table.address_count} addresses compressed into every bundle`}
                        {status === 'none' && 'No table built for this token yet — bundles will run without ALT compression.'}
                    </p>
                </div>
                {status === 'none' && (
                    <Button
                        type="button"
                        size="sm"
                        disabled={building || !devWalletId || walletIds.length === 0}
                        onClick={build}
                    >
                        {building ? 'Building…' : 'Build Lookup Table'}
                    </Button>
                )}
            </div>

            {status === 'none' && !devWalletId && (
                <p className="text-[11px] text-amber-500">
                    No dev wallet found on the Token node — needed as the ALT&apos;s paying authority.
                </p>
            )}
            {status === 'none' && devWalletId && walletIds.length === 0 && (
                <p className="text-[11px] text-muted-foreground">
                    Paste the Launch Totals JSON above first — the table needs the resolved wallet list.
                </p>
            )}
            {status === 'active' && table?.public_address && (
                <a
                    href={`https://solscan.io/account/${table.public_address}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="w-fit text-[11px] text-primary underline underline-offset-2"
                >
                    View on Solscan ↗
                </a>
            )}
            {error && <p className="text-[11px] text-destructive">{error}</p>}
        </div>
    )
}

function StaggerDelayInputs({ config, patch }: { config: Record<string, unknown>; patch: (p: Record<string, unknown>) => void }) {
    return (
        <div className="flex gap-3">
            <div className="flex flex-col gap-1.5">
                <Label className="text-xs">Min Delay (s)</Label>
                <Input
                    type="number" min={0}
                    value={(config.delayMinSeconds as string) ?? '5'}
                    onChange={(e) => patch({ delayMinSeconds: e.target.value })}
                    className="w-28"
                />
            </div>
            <div className="flex flex-col gap-1.5">
                <Label className="text-xs">Max Delay (s)</Label>
                <Input
                    type="number" min={0}
                    value={(config.delayMaxSeconds as string) ?? '30'}
                    onChange={(e) => patch({ delayMaxSeconds: e.target.value })}
                    className="w-28"
                />
            </div>
        </div>
    )
}

function StaggeredSellFields({ config, patch }: { config: Record<string, unknown>; patch: (p: Record<string, unknown>) => void }) {
    const sellPct = (config.sellPct as number) ?? 100

    function setSellPct(v: number) {
        patch({ sellPct: Math.min(100, Math.max(1, v)) })
    }

    return (
        <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-1.5">
                <Label className="text-xs">Sell Amount</Label>
                <div className="flex gap-1.5">
                    {[25, 50, 75, 100].map((p) => (
                        <button
                            key={p}
                            type="button"
                            onClick={() => setSellPct(p)}
                            className={[
                                'rounded-md border px-3 py-1.5 text-xs font-medium transition-colors',
                                sellPct === p
                                    ? 'border-red-500 bg-red-500/10 text-red-400'
                                    : 'border-border text-muted-foreground hover:border-red-400 hover:text-foreground',
                            ].join(' ')}
                        >
                            {p}%
                        </button>
                    ))}
                    <Input
                        type="number" min={1} max={100}
                        value={sellPct}
                        onChange={(e) => setSellPct(Number(e.target.value))}
                        className="w-20 text-xs"
                    />
                </div>
            </div>

            <div className="flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/5 px-3 py-2.5">
                <span className="mt-0.5 shrink-0 text-amber-400">⚠</span>
                <p className="text-xs text-amber-300/80">
                    Token balances are unknown until after launch and buys complete.
                    The sell % will be applied to each wallet&apos;s live balance at execution time.
                    WSS balance streaming will be wired in to keep these up to date.
                </p>
            </div>
        </div>
    )
}

// ── Trigger ──────────────────────────────────────────────────────────────

function TriggerFields({
    subtype,
    config,
    patch,
}: {
    subtype: TriggerSubtype
    config: Record<string, unknown>
    patch: (p: Record<string, unknown>) => void
}) {
    switch (subtype) {
        case 'timerSet':
            return (
                <div className="flex w-40 flex-col gap-1.5">
                    <Label className="text-xs">Seconds</Label>
                    <Input
                        type="number" min={0}
                        value={(config.seconds as number) ?? 5}
                        onChange={(e) => patch({ seconds: Number(e.target.value) })}
                    />
                </div>
            )
        case 'timerRandomInterval':
            return (
                <div className="flex gap-3">
                    <div className="flex flex-col gap-1.5">
                        <Label className="text-xs">Min Seconds</Label>
                        <Input
                            type="number" min={0}
                            value={(config.minSeconds as number) ?? 5}
                            onChange={(e) => patch({ minSeconds: Number(e.target.value) })}
                            className="w-28"
                        />
                    </div>
                    <div className="flex flex-col gap-1.5">
                        <Label className="text-xs">Max Seconds</Label>
                        <Input
                            type="number" min={0}
                            value={(config.maxSeconds as number) ?? 30}
                            onChange={(e) => patch({ maxSeconds: Number(e.target.value) })}
                            className="w-28"
                        />
                    </div>
                </div>
            )
        case 'humanInTheLoop':
            return (
                <div className="flex flex-col gap-1.5">
                    <Label className="text-xs">Instructions shown to the operator</Label>
                    <Textarea
                        value={(config.instructions as string) ?? ''}
                        onChange={(e) => patch({ instructions: e.target.value })}
                        placeholder="e.g. Confirm liquidity looks healthy before continuing"
                    />
                </div>
            )
        case 'launchConfirmation':
        case 'txConfirmation':
            return (
                <p className="text-xs text-muted-foreground">
                    This trigger gates on confirmation automatically — no configuration needed.
                </p>
            )
        case 'marketCapThreshold':
            return (
                <div className="flex flex-col gap-4">
                    <DirectionToggle config={config} patch={patch} />
                    <div className="flex flex-col gap-1.5">
                        <Label className="text-xs">Target Market Cap (USD)</Label>
                        <Input
                            type="number" min={0}
                            value={(config.targetMarketCapUSD as number) ?? 50000}
                            onChange={(e) => patch({ targetMarketCapUSD: Number(e.target.value) })}
                        />
                    </div>
                    <PollInterval config={config} patch={patch} defaultSeconds={10} />
                </div>
            )
        case 'holderCountThreshold':
            return (
                <div className="flex flex-col gap-4">
                    <DirectionToggle config={config} patch={patch} />
                    <div className="flex flex-col gap-1.5">
                        <Label className="text-xs">Target Holder Count</Label>
                        <Input
                            type="number" min={1}
                            value={(config.targetHolderCount as number) ?? 100}
                            onChange={(e) => patch({ targetHolderCount: Number(e.target.value) })}
                        />
                    </div>
                    <PollInterval config={config} patch={patch} defaultSeconds={15} />
                </div>
            )
        case 'volumeThreshold':
            return (
                <div className="flex flex-col gap-4">
                    <div className="flex flex-col gap-1.5">
                        <Label className="text-xs">Target Volume (SOL)</Label>
                        <Input
                            type="number" min={0}
                            value={(config.targetVolumeSol as number) ?? 10}
                            onChange={(e) => patch({ targetVolumeSol: Number(e.target.value) })}
                        />
                    </div>
                    <PollInterval config={config} patch={patch} defaultSeconds={10} />
                </div>
            )
        case 'priceTarget':
            return (
                <div className="flex flex-col gap-4">
                    <DirectionToggle config={config} patch={patch} />
                    <div className="flex flex-col gap-1.5">
                        <Label className="text-xs">Target Price (USD)</Label>
                        <Input
                            type="number" min={0} step="any"
                            value={(config.targetPriceUSD as number) ?? 0.001}
                            onChange={(e) => patch({ targetPriceUSD: Number(e.target.value) })}
                        />
                    </div>
                    <PollInterval config={config} patch={patch} defaultSeconds={5} />
                </div>
            )
        case 'retryBackoff':
            return (
                <div className="flex flex-col gap-4">
                    <div className="grid grid-cols-2 gap-3">
                        <div className="flex flex-col gap-1.5">
                            <Label className="text-xs">Max Retries</Label>
                            <Input
                                type="number" min={1} max={20}
                                value={(config.maxRetries as number) ?? 3}
                                onChange={(e) => patch({ maxRetries: Number(e.target.value) })}
                            />
                        </div>
                        <div className="flex flex-col gap-1.5">
                            <Label className="text-xs">Initial Delay (s)</Label>
                            <Input
                                type="number" min={1}
                                value={(config.initialDelaySeconds as number) ?? 5}
                                onChange={(e) => patch({ initialDelaySeconds: Number(e.target.value) })}
                            />
                        </div>
                        <div className="flex flex-col gap-1.5">
                            <Label className="text-xs">Multiplier</Label>
                            <Input
                                type="number" min={1} max={10} step={0.5}
                                value={(config.multiplier as number) ?? 2}
                                onChange={(e) => patch({ multiplier: Number(e.target.value) })}
                            />
                        </div>
                        <div className="flex flex-col gap-1.5">
                            <Label className="text-xs">Max Delay (s)</Label>
                            <Input
                                type="number" min={1}
                                value={(config.maxDelaySeconds as number) ?? 60}
                                onChange={(e) => patch({ maxDelaySeconds: Number(e.target.value) })}
                            />
                        </div>
                    </div>
                    <p className="text-xs text-muted-foreground">
                        Delays: {(config.initialDelaySeconds as number) ?? 5}s → {((config.initialDelaySeconds as number) ?? 5) * ((config.multiplier as number) ?? 2)}s → {Math.min(((config.initialDelaySeconds as number) ?? 5) * Math.pow((config.multiplier as number) ?? 2, 2), (config.maxDelaySeconds as number) ?? 60)}s …
                    </p>
                </div>
            )
        case 'branchReset':
            return (
                <div className="flex flex-col gap-4">
                    <div className="flex w-40 flex-col gap-1.5">
                        <Label className="text-xs">Max Resets (safety limit)</Label>
                        <Input
                            type="number" min={1} max={1000}
                            value={(config.maxResets as number) ?? 10}
                            onChange={(e) => patch({ maxResets: Number(e.target.value) })}
                        />
                    </div>
                    <p className="text-xs text-muted-foreground">
                        Wire this node&apos;s output back to an earlier node in the branch (e.g. a Human In The Loop
                        trigger) to form a cycle. Each time flow reaches this node it re-arms and re-runs everything
                        downstream until the reset count above is hit, then the branch stops.
                    </p>
                </div>
            )
        default:
            return null
    }
}

function DirectionToggle({ config, patch }: { config: Record<string, unknown>; patch: (p: Record<string, unknown>) => void }) {
    const direction = (config.direction as string) ?? 'above'
    return (
        <div className="flex flex-col gap-1.5">
            <Label className="text-xs">Direction</Label>
            <div className="flex gap-2">
                {(['above', 'below'] as const).map((d) => (
                    <button
                        key={d}
                        type="button"
                        onClick={() => patch({ direction: d })}
                        className={[
                            'rounded-md border px-3 py-1 text-xs transition-colors',
                            direction === d
                                ? 'border-amber-500 bg-amber-500/10 text-amber-400'
                                : 'border-border text-muted-foreground hover:border-muted-foreground',
                        ].join(' ')}
                    >
                        {d === 'above' ? '≥ Above' : '≤ Below'}
                    </button>
                ))}
            </div>
        </div>
    )
}

function PollInterval({ config, patch, defaultSeconds }: { config: Record<string, unknown>; patch: (p: Record<string, unknown>) => void; defaultSeconds: number }) {
    return (
        <div className="flex w-40 flex-col gap-1.5">
            <Label className="text-xs">Poll Interval (s)</Label>
            <Input
                type="number" min={1}
                value={(config.pollIntervalSeconds as number) ?? defaultSeconds}
                onChange={(e) => patch({ pollIntervalSeconds: Number(e.target.value) })}
            />
        </div>
    )
}

// ── Conditional ─��──────────────────���──────────────────────────────���──────

function ConditionalFields({
    subtype,
    config,
    patch,
}: {
    subtype: ConditionalSubtype
    config: Record<string, unknown>
    patch: (p: Record<string, unknown>) => void
}) {
    if (subtype === 'loop') {
        return (
            <div className="flex w-40 flex-col gap-1.5">
                <Label className="text-xs">Max Iterations</Label>
                <Input
                    type="number" min={1}
                    value={(config.maxIterations as number) ?? 3}
                    onChange={(e) => patch({ maxIterations: Number(e.target.value) })}
                />
            </div>
        )
    }

    if (subtype === 'ifThen') {
        return (
            <div className="flex flex-col gap-1.5">
                <Label className="text-xs">Condition</Label>
                <Input
                    value={(config.condition as string) ?? ''}
                    onChange={(e) => patch({ condition: e.target.value })}
                    placeholder="e.g. holderCount > 50"
                />
            </div>
        )
    }

    // switch
    const branchCount = (config.branchCount as number) ?? 2
    const branchLabels = (config.branchLabels as string[]) ?? Array.from({ length: branchCount }, (_, i) => `Case ${i + 1}`)

    function setBranchCount(n: number) {
        const clamped = Math.max(2, Math.min(8, n))
        const labels = Array.from({ length: clamped }, (_, i) => branchLabels[i] ?? `Case ${i + 1}`)
        patch({ branchCount: clamped, branchLabels: labels })
    }

    function setBranchLabel(i: number, label: string) {
        const next = [...branchLabels]
        next[i] = label
        patch({ branchLabels: next })
    }

    return (
        <div className="flex flex-col gap-3">
            <div className="flex w-40 flex-col gap-1.5">
                <Label className="text-xs">Branch Count</Label>
                <Input
                    type="number" min={2} max={8}
                    value={branchCount}
                    onChange={(e) => setBranchCount(Number(e.target.value))}
                />
            </div>
            <div className="flex flex-col gap-2">
                {branchLabels.map((label, i) => (
                    <div key={i} className="flex items-center gap-2">
                        <span className="w-16 shrink-0 text-xs text-muted-foreground">Output {i + 1}</span>
                        <Input value={label} onChange={(e) => setBranchLabel(i, e.target.value)} />
                    </div>
                ))}
            </div>
        </div>
    )
}

// ── Utility (Data + Webhook) ─────────────────────────────────────────────

function UtilityFields({
    subtype,
    config,
    patch,
    nodeId,
    nodes,
    edges,
}: {
    subtype: UtilitySubtype
    config: Record<string, unknown>
    patch: (p: Record<string, unknown>) => void
    nodeId: string
    nodes: Node[]
    edges: Edge[]
}) {
    if (subtype === 'dataMapper') {
        return <DataFields config={config} patch={patch} nodeId={nodeId} nodes={nodes} edges={edges} />
    }
    if (subtype === 'webhook') {
        return <WebhookFields config={config} patch={patch} />
    }
    if (subtype === 'setVariable') {
        return <SetVariableFields config={config} patch={patch} nodeId={nodeId} nodes={nodes} edges={edges} />
    }
    return <p className="text-xs text-muted-foreground">No configuration needed — pure passthrough.</p>
}

// ── Data Fields ──────────────────────────────────────────────────────────

function DataFields({
    config,
    patch,
    nodeId,
    nodes,
    edges,
}: {
    config: Record<string, unknown>
    patch: (p: Record<string, unknown>) => void
    nodeId: string
    nodes: Node[]
    edges: Edge[]
}) {
    const [customFields, setCustomFields] = useState<{ key: string; value: string }[]>(
        (config.customFields as { key: string; value: string }[]) ?? [],
    )
    const availableVariables = collectAvailableVariables(nodeId, nodes, edges)

    function updateCustomFields(next: { key: string; value: string }[]) {
        setCustomFields(next)
        patch({ customFields: next })
    }

    function addField() { updateCustomFields([...customFields, { key: '', value: '' }]) }

    function updateField(i: number, field: Partial<{ key: string; value: string }>) {
        updateCustomFields(customFields.map((f, idx) => (idx === i ? { ...f, ...field } : f)))
    }

    function removeField(i: number) { updateCustomFields(customFields.filter((_, idx) => idx !== i)) }

    return (
        <div className="flex flex-col gap-5">
            <div className="flex flex-col gap-2">
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Custom Fields</p>
                <p className="text-xs text-muted-foreground">
                    This node sends exactly the fields defined below — nothing is included automatically. A value of{' '}
                    <span className="font-mono">{'{{variableName}}'}</span> is resolved at Run time against any named
                    variable — a Set Variable node, or auto-set by a named Token/Trade/Launch node (e.g. name your
                    Token node <span className="font-mono">token1</span> and reference{' '}
                    <span className="font-mono">{'{{token1.tokenMint}}'}</span>). Use the{' '}
                    <span className="font-mono">{'{ }'}</span> button to insert a variable named on a node upstream
                    of this one — only names are known here, not their values, which only exist while a Run is
                    executing.
                </p>
                {customFields.length === 0 && (
                    <p className="text-xs text-muted-foreground">No custom fields yet.</p>
                )}
                {customFields.map((field, i) => (
                    <div key={i} className="flex items-center gap-2">
                        <Input
                            placeholder="key"
                            value={field.key}
                            onChange={(e) => updateField(i, { key: e.target.value })}
                            className="w-36 font-mono text-xs"
                        />
                        <span className="shrink-0 text-muted-foreground">=</span>
                        <Input
                            placeholder="value or {{variableName}}"
                            value={field.value}
                            onChange={(e) => updateField(i, { value: e.target.value })}
                            className="flex-1 font-mono text-xs"
                        />
                        <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                                <button
                                    type="button"
                                    title="Insert a named variable"
                                    className="flex shrink-0 items-center gap-0.5 rounded-md border border-border px-1.5 py-1 text-xs font-mono text-muted-foreground transition-colors hover:border-foreground/40 hover:text-foreground"
                                >
                                    {'{ }'}
                                    <ChevronDown className="size-3" />
                                </button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                                <DropdownMenuLabel className="text-xs">Named variables upstream of this node</DropdownMenuLabel>
                                <DropdownMenuSeparator />
                                {availableVariables.length === 0 && (
                                    <p className="px-2 py-1.5 text-xs text-muted-foreground">
                                        No named nodes upstream yet — rename a Token/Trade/Launch node, or add a Set
                                        Variable node, and wire it in ahead of this one.
                                    </p>
                                )}
                                {availableVariables.map(({ name, fields }) => (
                                    <DropdownMenuGroup key={name}>
                                        <DropdownMenuItem
                                            className="font-mono text-xs"
                                            onSelect={() => updateField(i, { value: `{{${name}}}` })}
                                        >
                                            {'{{' + name + '}}'}
                                        </DropdownMenuItem>
                                        {fields.map((f) => (
                                            <DropdownMenuItem
                                                key={`${name}.${f.key}`}
                                                className="pl-5 font-mono text-xs text-muted-foreground"
                                                onSelect={() => updateField(i, { value: `{{${name}.${f.key}}}` })}
                                            >
                                                {'{{' + name + '.' + f.key + '}}'}
                                            </DropdownMenuItem>
                                        ))}
                                    </DropdownMenuGroup>
                                ))}
                            </DropdownMenuContent>
                        </DropdownMenu>
                        <button
                            type="button"
                            onClick={() => removeField(i)}
                            className="shrink-0 px-1 text-xs text-muted-foreground transition-colors hover:text-destructive"
                        >
                            ✕
                        </button>
                    </div>
                ))}
                <button
                    type="button"
                    onClick={addField}
                    className="self-start text-xs text-muted-foreground transition-colors hover:text-foreground"
                >
                    + Add field
                </button>
            </div>
        </div>
    )
}

// ── Set Variable ─────────────────────────────────────────────────────────

function SetVariableFields({
    config,
    patch,
    nodeId,
    nodes,
    edges,
}: {
    config: Record<string, unknown>
    patch: (p: Record<string, unknown>) => void
    nodeId: string
    nodes: Node[]
    edges: Edge[]
}) {
    const [variableName, setVariableName] = useState<string>((config.variableName as string) ?? '')
    const [selectedWalletIds, setSelectedWalletIds] = useState<Set<string>>(
        new Set((config.selectedWalletIds as string[]) ?? []),
    )
    const tokenNodeData = findTokenNodeData(nodeId, nodes, edges)
    const tokenMint = (tokenNodeData?.config.tokenMint as string | undefined) ?? undefined

    function updateVariableName(v: string) {
        setVariableName(v)
        patch({ variableName: v.trim() })
    }

    function updateWallets(ids: Set<string>) {
        setSelectedWalletIds(ids)
        patch({ selectedWalletIds: Array.from(ids) })
    }

    return (
        <div className="flex flex-col gap-5">
            <div className="flex w-64 flex-col gap-1.5">
                <Label className="text-xs">Variable Name</Label>
                <Input
                    value={variableName}
                    onChange={(e) => updateVariableName(e.target.value)}
                    placeholder="e.g. traders"
                    className="font-mono text-xs"
                />
                <p className="text-xs text-muted-foreground">
                    Reference this wallet group elsewhere as <span className="font-mono">{'{{' + (variableName.trim() || 'name') + '}}'}</span> —
                    e.g. in a Data node&apos;s custom field value.
                </p>
            </div>

            <StrategyWalletSelector
                selectedIds={selectedWalletIds}
                onSelectionChange={updateWallets}
                onTradeAmountChange={() => {}}
                onTradeAmountReset={() => {}}
                defaultTypeName="Trader"
                tradeType="sell"
                tokenMint={tokenMint}
                hideTradeAmountColumn
            />
        </div>
    )
}

// ── Webhook Fields ───────────────────────────────────────────────────────

type AuthType = 'none' | 'bearer' | 'apiKey'

function WebhookFields({
    config,
    patch,
}: {
    config: Record<string, unknown>
    patch: (p: Record<string, unknown>) => void
}) {
    const [url,           setUrl]           = useState<string>((config.url        as string)   ?? '')
    const [authType,      setAuthType]      = useState<AuthType>((config.authType as AuthType) ?? 'none')
    const [authValue,     setAuthValue]     = useState<string>((config.authValue  as string)   ?? '')
    const [customHeaders, setCustomHeaders] = useState<{ key: string; value: string }[]>(
        (config.customHeaders as { key: string; value: string }[]) ?? [],
    )

    function updateUrl(v: string)          { setUrl(v);       patch({ url: v }) }
    function updateAuthType(v: AuthType)   { setAuthType(v);  patch({ authType: v }) }
    function updateAuthValue(v: string)    { setAuthValue(v); patch({ authValue: v }) }

    function updateHeaders(next: { key: string; value: string }[]) {
        setCustomHeaders(next)
        patch({ customHeaders: next })
    }

    function addHeader() { updateHeaders([...customHeaders, { key: '', value: '' }]) }
    function updateHeader(i: number, field: Partial<{ key: string; value: string }>) {
        updateHeaders(customHeaders.map((h, idx) => (idx === i ? { ...h, ...field } : h)))
    }
    function removeHeader(i: number) { updateHeaders(customHeaders.filter((_, idx) => idx !== i)) }

    return (
        <div className="flex flex-col gap-5">
            <div className="flex flex-col gap-1.5">
                <Label className="text-xs">Endpoint URL</Label>
                <Input
                    placeholder="https://hooks.example.com/launch"
                    value={url}
                    onChange={(e) => updateUrl(e.target.value)}
                    className="font-mono text-xs"
                />
                <p className="text-xs text-muted-foreground">
                    Receives a POST with the data payload as JSON body. Waits for a 2xx response before continuing.
                </p>
            </div>

            <div className="flex flex-col gap-2">
                <Label className="text-xs">Authentication</Label>
                <div className="flex gap-2">
                    {(['none', 'bearer', 'apiKey'] as AuthType[]).map((t) => (
                        <button
                            key={t}
                            type="button"
                            onClick={() => updateAuthType(t)}
                            className={[
                                'rounded-md border px-3 py-1 text-xs transition-colors',
                                authType === t
                                    ? 'border-cyan-500 bg-cyan-500/10 text-cyan-400'
                                    : 'border-border text-muted-foreground hover:border-muted-foreground',
                            ].join(' ')}
                        >
                            {t === 'none' ? 'None' : t === 'bearer' ? 'Bearer Token' : 'API Key'}
                        </button>
                    ))}
                </div>
                {authType !== 'none' && (
                    <Input
                        placeholder={authType === 'bearer' ? 'Bearer token value' : 'API key value'}
                        value={authValue}
                        onChange={(e) => updateAuthValue(e.target.value)}
                        type="password"
                        className="font-mono text-xs"
                    />
                )}
            </div>

            <div className="flex flex-col gap-2">
                <Label className="text-xs">Custom Headers</Label>
                {customHeaders.length === 0 && (
                    <p className="text-xs text-muted-foreground">No custom headers.</p>
                )}
                {customHeaders.map((header, i) => (
                    <div key={i} className="flex items-center gap-2">
                        <Input
                            placeholder="Header-Name"
                            value={header.key}
                            onChange={(e) => updateHeader(i, { key: e.target.value })}
                            className="w-40 font-mono text-xs"
                        />
                        <span className="shrink-0 text-muted-foreground">:</span>
                        <Input
                            placeholder="value"
                            value={header.value}
                            onChange={(e) => updateHeader(i, { value: e.target.value })}
                            className="flex-1 font-mono text-xs"
                        />
                        <button
                            type="button"
                            onClick={() => removeHeader(i)}
                            className="shrink-0 px-1 text-xs text-muted-foreground transition-colors hover:text-destructive"
                        >
                            ✕
                        </button>
                    </div>
                ))}
                <button
                    type="button"
                    onClick={addHeader}
                    className="self-start text-xs text-muted-foreground transition-colors hover:text-foreground"
                >
                    + Add header
                </button>
            </div>
        </div>
    )
}
