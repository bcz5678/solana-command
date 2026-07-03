'use client'

import { useState } from 'react'
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
import LaunchTokenSelect from '@/components/tokens/launch/launch-token-select'
import LaunchBuyerConfig from '@/components/tokens/launch/launch-buyer-config'
import { LaunchConfig } from '@/components/tokens/launch/launch-config-class'
import { LaunchType } from '@/components/tokens/launch/types'
import { TokenMint } from '@/lib/types/token-mint'
import { WalletTradeDTO } from '@/lib/types/wallet'
import { solStringToLamports } from '@/lib/lamports'
import StrategyWalletSelector from '@/components/trade/strategy-trade/strategy-wallet-selector'
import { SlippageControl } from '@/components/trade/trade/SlippageControl'
import { BuilderNodeData, LaunchTypeSubtype, TradeSubtype, TriggerSubtype, ConditionalSubtype, UtilitySubtype } from './types'
import { PALETTE_ITEMS } from './node-palette-config'
import { findTokenNodeData } from './handle-types'

type Props = {
    node: Node | null
    nodes: Node[]
    edges: Edge[]
    onOpenChange: (open: boolean) => void
    onSave: (nodeId: string, config: Record<string, unknown>) => void
}

export default function NodeConfigDialog({ node, nodes, edges, onOpenChange, onSave }: Props) {
    const data = node?.data as unknown as BuilderNodeData | undefined

    return (
        <Dialog open={!!node} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-lg">
                {node && data && (
                    <ConfigBody
                        key={node.id}
                        nodeId={node.id}
                        data={data}
                        nodes={nodes}
                        edges={edges}
                        onSave={onSave}
                        onClose={() => onOpenChange(false)}
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
}: {
    nodeId: string
    data: BuilderNodeData
    nodes: Node[]
    edges: Edge[]
    onSave: Props['onSave']
    onClose: () => void
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
    return trades.map((t) => ({
        walletId: t.walletId,
        tradeType: t.tradeType,
        buyAmountInSOL: new BN(t.buyAmountInSOL),
        tokensAmountHeld: t.tokensAmountHeld != null ? new BN(t.tokensAmountHeld) : null,
        percentOfSupplyHeld: t.percentOfSupplyHeld != null ? new BN(t.percentOfSupplyHeld) : null,
        marketCapAtBuy: t.marketCapAtBuy != null ? new BN(t.marketCapAtBuy) : null,
    }))
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
    const devOnly = subtype === 'dev0DevOnly'

    const tokenNodeData = findTokenNodeData(nodeId, nodes, edges)
    const devWalletId = (tokenNodeData?.config.devWalletId as string | null | undefined) ?? null

    const [launchConfig, setLaunchConfig] = useState<LaunchConfig>(
        () =>
            new LaunchConfig(
                LaunchType.unselected,
                // LaunchBuyerConfig only reads `token.dev_wallet_id` — a partial stand-in is fine here.
                devWalletId ? ({ dev_wallet_id: devWalletId } as unknown as TokenMint) : null,
                new BN(0),
                new BN(0),
                new BN(0),
                new BN(0),
                deserializeWalletTrades(config.walletTrades),
            ),
    )

    function persist(next: LaunchConfig) {
        setLaunchConfig(next)
        const json = next.toJSON()
        patch({ walletTrades: json.walletTrades, totalSOLInLamports: json.totalSOLInLamports })
    }

    function onBuyInputChange(walletId: string, newAmount: string) {
        const newAmountInLamports = newAmount === '' || newAmount === '.' ? new BN(0) : solStringToLamports(newAmount)
        launchConfig.updateWalletList(walletId, newAmountInLamports, 'buy')
        persist(launchConfig.copyWith({
            walletTrades: launchConfig.walletTrades,
            totalSOLInLamports: launchConfig.totalSOLInLamports,
        }))
    }

    function onBuyInputReset() {
        launchConfig.clearWalletList()
        persist(launchConfig.copyWith({
            walletTrades: launchConfig.walletTrades,
            totalSOLInLamports: launchConfig.totalSOLInLamports,
        }))
    }

    return (
        <div className="flex flex-col gap-3">
            {!devWalletId && (
                <p className="text-xs text-muted-foreground">
                    No token selected yet — add a Token node and select a token to{' '}
                    {devOnly ? 'configure its dev wallet buy here.' : 'highlight its dev wallet here.'}
                </p>
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

    function updateWallets(ids: Set<string>) {
        setSelectedWalletIds(ids)
        patch({ selectedWalletIds: Array.from(ids) })
    }

    function updateAmount(id: string, amount: string) {
        setTradeAmounts((prev) => {
            const next = { ...prev, [id]: amount }
            patch({ tradeAmounts: next })
            return next
        })
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

            {subtype === 'staggeredSell' && (
                <StaggeredSellFields config={config} patch={patch} />
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

            <SlippageControl value={slippage} onChange={updateSlippage} />

            <StrategyWalletSelector
                selectedIds={selectedWalletIds}
                onSelectionChange={updateWallets}
                onTradeAmountChange={updateAmount}
                onTradeAmountReset={resetAmounts}
                tradeAmounts={tradeAmounts}
                defaultTypeName="Trader"
            />
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
    return <WebhookFields config={config} patch={patch} />
}

// ── Data Fields ──────────────────────────────────────────────────────────

const SYSTEM_FIELDS: { key: string; label: string; source: (d: BuilderNodeData | null) => string }[] = [
    { key: 'tokenMint',          label: 'Token Mint',            source: (d) => (d?.config.tokenMint   as string) ?? '' },
    { key: 'tokenName',          label: 'Token Name',            source: (d) => (d?.config.tokenName   as string) ?? '' },
    { key: 'tokenSymbol',        label: 'Token Symbol',          source: (d) => (d?.config.tokenSymbol as string) ?? '' },
    { key: 'devWalletPublicKey', label: 'Dev Wallet Public Key', source: (d) => (d?.config.devWalletId as string) ?? '' },
]

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
    const tokenData = findTokenNodeData(nodeId, nodes, edges)
    const [customFields, setCustomFields] = useState<{ key: string; value: string }[]>(
        (config.customFields as { key: string; value: string }[]) ?? [],
    )

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
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">System Fields</p>
                <p className="text-xs text-muted-foreground">
                    Always included — resolved from the connected Token node at runtime.
                </p>
                <div className="rounded-md border border-border divide-y divide-border">
                    {SYSTEM_FIELDS.map(({ key, label, source }) => {
                        const resolved = source(tokenData)
                        return (
                            <div key={key} className="flex items-center gap-3 px-3 py-2">
                                <span className="w-40 shrink-0 font-mono text-xs text-foreground">{key}</span>
                                <span className="min-w-0 flex-1 truncate font-mono text-xs text-muted-foreground">
                                    {resolved || <span className="italic opacity-50">{label} — connect Token node</span>}
                                </span>
                            </div>
                        )
                    })}
                </div>
            </div>

            <div className="flex flex-col gap-2">
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Custom Fields</p>
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
                            placeholder="value"
                            value={field.value}
                            onChange={(e) => updateField(i, { value: e.target.value })}
                            className="flex-1 font-mono text-xs"
                        />
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
