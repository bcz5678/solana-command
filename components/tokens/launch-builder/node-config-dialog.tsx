'use client'

import { useState } from 'react'
import type { Node } from '@xyflow/react'
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
import { TokenMintInput } from '@/components/trade/strategy-trade/TokenMintInput'
import StrategyWalletSelector from '@/components/trade/strategy-trade/strategy-wallet-selector'
import { SlippageControl } from '@/components/trade/trade/SlippageControl'
import { BuilderNodeData, LaunchTypeSubtype, TradeSubtype, TriggerSubtype, ConditionalSubtype } from './types'
import { PALETTE_ITEMS } from './node-palette-config'

type Props = {
    node: Node | null
    nodes: Node[]
    onOpenChange: (open: boolean) => void
    onSave: (nodeId: string, config: Record<string, unknown>) => void
}

export default function NodeConfigDialog({ node, nodes, onOpenChange, onSave }: Props) {
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
    onSave,
    onClose,
}: {
    nodeId: string
    data: BuilderNodeData
    nodes: Node[]
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
                        nodes={nodes}
                    />
                )}

                {data.category === 'trade' && (
                    <TradeFields subtype={data.subtype as TradeSubtype} config={config} patch={patch} />
                )}

                {data.category === 'trigger' && (
                    <TriggerFields subtype={data.subtype as TriggerSubtype} config={config} patch={patch} />
                )}

                {data.category === 'conditional' && (
                    <ConditionalFields subtype={data.subtype as ConditionalSubtype} config={config} patch={patch} />
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
    nodes,
}: {
    subtype: LaunchTypeSubtype
    config: Record<string, unknown>
    patch: (p: Record<string, unknown>) => void
    nodes: Node[]
}) {
    const devOnly = subtype === 'dev0DevOnly'

    // The dev wallet to highlight comes from whatever Token node is on the
    // canvas — there's no graph data-flow evaluation yet, so we just look it up directly.
    const tokenNode = nodes
        .map((n) => n.data as unknown as BuilderNodeData)
        .find((d) => d.category === 'token')
    const devWalletId = (tokenNode?.config.devWalletId as string | null | undefined) ?? null

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
}: {
    subtype: TradeSubtype
    config: Record<string, unknown>
    patch: (p: Record<string, unknown>) => void
}) {
    const [selectedWalletIds, setSelectedWalletIds] = useState<Set<string>>(
        new Set((config.selectedWalletIds as string[]) ?? []),
    )
    const [tradeAmounts, setTradeAmounts] = useState<Record<string, string>>(
        (config.tradeAmounts as Record<string, string>) ?? {},
    )
    const [slippage, setSlippage] = useState<number>((config.slippage as number) ?? 0.05)

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
            <div className="flex flex-col gap-1.5">
                <Label className="text-xs">Token</Label>
                <TokenMintInput
                    onTokenChange={(mint, resolved, name, symbol) =>
                        patch({ tokenMint: mint, tokenResolved: resolved, tokenName: name, tokenSymbol: symbol })
                    }
                />
            </div>

            {subtype === 'staggeredBuy' && (
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
        default:
            return null
    }
}

// ── Conditional ──────────────────────────────────────────────────────────

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
