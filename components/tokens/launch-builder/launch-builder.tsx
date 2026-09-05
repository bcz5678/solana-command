'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
    ReactFlowProvider,
    useNodesState,
    useEdgesState,
    addEdge,
    type Node,
    type Edge,
    type Connection,
} from '@xyflow/react'
import LaunchBuilderPalette from './launch-builder-palette'
import LaunchBuilderCanvas from './launch-builder-canvas'
import LaunchBuilderToolbar from './launch-builder-toolbar'
import NodeConfigDialog from './node-config-dialog'
import BundleLoopPanel, { type BundleLoopState, type BundleLoopRow } from './bundle-loop-panel'
import { stratifiedInterleave } from '@/lib/trade/stratified-interleave'
import { useRelayEvent } from '@/hooks/use-relay-event'
import type { TokenTransactionEvent } from '@/lib/wss/types'
import LaunchTradeFeedPanel from '@/components/tokens/launch/launch-trade-feed-panel'
import { BuilderNodeData, ParsedBundledWallet } from './types'
import { buildLaunchProfile, applyLaunchProfile, type LaunchProfile } from './launch-profile'
import { getExecEntryNodeIds, getDownstreamNodeIds, getDownstreamNodeIdsByHandle, buildDataNodePayload, findTokenNodeData } from './handle-types'
import { LaunchType } from '@/components/tokens/launch/types'
import { solStringToLamports } from '@/lib/lamports'

const DEFAULT_JITO_TIP_SOL = '0.001'

function jitoTipLamportsFromConfig(config: Record<string, unknown>): string {
    const raw = (config.jitoTipSol as string | undefined) ?? DEFAULT_JITO_TIP_SOL
    try {
        return solStringToLamports(raw).toString()
    } catch {
        return solStringToLamports(DEFAULT_JITO_TIP_SOL).toString()
    }
}

const RUN_STEP_MS = 550

export default function LaunchBuilder() {
    return (
        <ReactFlowProvider>
            <LaunchBuilderInner />
        </ReactFlowProvider>
    )
}

function LaunchBuilderInner() {
    const [nodes, setNodes, onNodesChange] = useNodesState<Node>([])
    const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([])
    const [configNodeId, setConfigNodeId]  = useState<string | null>(null)
    const [profileName, setProfileName]    = useState('Untitled Launch')
    const [configId, setConfigId]          = useState<string | null>(null)
    const [templateId, setTemplateId]      = useState<string | null>(null)
    // Name the current templateId was loaded/saved under — if the name has
    // since diverged, the next Save Template forks a new row instead of
    // overwriting the original template.
    const [templateName, setTemplateName]  = useState<string | null>(null)
    // Defaults on every session — flipping it off (real funds, real trades)
    // requires an explicit confirmation in the toolbar.
    const [testMode, setTestMode]          = useState(true)

    const profile = useMemo(
        () => buildLaunchProfile(nodes, edges, { name: profileName }),
        [nodes, edges, profileName],
    )

    // Kept in refs (not useCallback deps) so `runDryRun`'s identity stays
    // stable — node.data.onRun closures are created once at drop/load time
    // and must always see the latest edges/nodes, not a stale snapshot.
    const edgesRef = useRef<Edge[]>(edges)
    useEffect(() => { edgesRef.current = edges }, [edges])
    const nodesRef = useRef<Node[]>(nodes)
    useEffect(() => { nodesRef.current = nodes }, [nodes])
    const testModeRef = useRef(testMode)
    useEffect(() => { testModeRef.current = testMode }, [testMode])

    // Pending Human In The Loop pauses, keyed by node id — persistent across
    // runs (not per-run), since node ids are unique and a HITL node inside a
    // Loop's body pauses again on every iteration. Previously this map was
    // recreated per runDryRun() call and resolved through a single "current
    // run" ref, so starting a second run (or a second loop iteration) while
    // an earlier pause was still pending silently orphaned it — its Continue
    // button kept rendering but no longer did anything.
    const hitlWaitingRef = useRef<Map<string, () => void>>(new Map())
    const onContinueNode = useCallback((nodeId: string) => {
        const resolve = hitlWaitingRef.current.get(nodeId)
        if (!resolve) return
        hitlWaitingRef.current.delete(nodeId)
        setNodes((nds) => nds.map((n) => (n.id === nodeId ? { ...n, data: { ...n.data, awaitingContinue: false } } : n)))
        resolve()
    }, [setNodes])

    // Bundled Jito loop progress dialog. Only one loop runs at a time in
    // practice, but keyed by node id (like hitlWaitingRef) so a stray resolver
    // never fires against the wrong run.
    // Live trade feed for whatever mint most recently launched for real in this
    // session — a dry run never broadcasts, so there's no real mint on-chain to
    // watch, and the panel is intentionally not shown for those (see callLaunch).
    const [launchedToken, setLaunchedToken] = useState<{ mintAddress: string; tokenSymbol: string | null } | null>(null)
    const [ourWallets, setOurWallets]             = useState<Set<string>>(new Set())
    const [ourWalletLabels, setOurWalletLabels]   = useState<Record<string, string>>({})
    // walletId -> publicKey, so callStaggeredTrade (a plain async fn, not a
    // component) can resolve which live trades belong to its own run without
    // re-fetching — populated by the same explorer call as ourWallets above.
    const walletIdToPublicKeyRef = useRef<Map<string, string>>(new Map())

    useEffect(() => {
        if (!launchedToken) return
        fetch('/api/wallets/explorer')
            .then((r) => (r.ok ? r.json() : null))
            .then((data) => {
                if (!data) return
                const wallets = (data.wallets ?? []) as { id: string; public_key: string; label: string | null }[]
                setOurWallets(new Set(wallets.map((w) => w.public_key)))
                const labels: Record<string, string> = {}
                for (const w of wallets) if (w.label) labels[w.public_key] = w.label
                setOurWalletLabels(labels)
                walletIdToPublicKeyRef.current = new Map(wallets.map((w) => [w.id, w.public_key]))
            })
            .catch(() => {})
    }, [launchedToken])

    // Front-running auto-halt (staggered nodes only — see callStaggeredTrade).
    // Keyed by nodeId since more than one staggered node could theoretically
    // run concurrently; each entry tracks its own run's wallet set and
    // trailing foreign-trade timestamps so runs never interfere with each
    // other. A plain mutable ref, not state — read/written from inside the
    // relay handler and the non-reactive callStaggeredTrade loop, neither of
    // which should trigger a re-render.
    const autoHaltRunsRef = useRef<Map<string, {
        mintAddress: string
        ourWalletKeys: Set<string>
        thresholdCount: number
        windowMs: number
        foreignTimestamps: number[]
        triggered: boolean
    }>>(new Map())

    useRelayEvent('token-transaction', (e: TokenTransactionEvent) => {
        for (const run of autoHaltRunsRef.current.values()) {
            if (run.triggered) continue
            if (run.mintAddress !== e.mint) continue
            if (run.ourWalletKeys.has(e.wallet)) continue
            const nowMs = e.timestamp * 1000
            run.foreignTimestamps.push(nowMs)
            run.foreignTimestamps = run.foreignTimestamps.filter((t) => nowMs - t <= run.windowMs)
            if (run.foreignTimestamps.length >= run.thresholdCount) run.triggered = true
        }
    })

    const [bundleLoop, setBundleLoop] = useState<BundleLoopState | null>(null)
    const bundleLoopDecisionRef = useRef<Map<string, (action: 'retry' | 'skip') => void>>(new Map())
    const onRetryBundle = useCallback(() => {
        if (!bundleLoop) return
        const resolve = bundleLoopDecisionRef.current.get(bundleLoop.nodeId)
        resolve?.('retry')
    }, [bundleLoop])
    const onSkipBundle = useCallback(() => {
        if (!bundleLoop) return
        const resolve = bundleLoopDecisionRef.current.get(bundleLoop.nodeId)
        resolve?.('skip')
    }, [bundleLoop])
    const onCloseBundleLoop = useCallback(() => setBundleLoop(null), [])

    const runDryRun = useCallback(
        (execNodeId: string) => {
            const entryIds = getExecEntryNodeIds(execNodeId, edgesRef.current)
            if (entryIds.length === 0) return

            setNodes((nds) => nds.map((n) => ({
                ...n,
                selected: false,
                data: { ...n.data, awaitingContinue: false, runCountdown: undefined, executionResult: undefined },
            })))

            // Each branch walks independently on its own timer — a Human In The
            // Loop pause or a Timer countdown only blocks the branch it's on,
            // not sibling branches that forked off earlier (e.g. from a Switch).
            const activeIds = new Set<string>()
            // Plain synchronous map, not React state — a downstream Confirmation
            // node's checkConfirmation() runs immediately after its upstream
            // node's setResult() in the same walk() continuation, well before a
            // setNodes()-triggered re-render (and the nodesRef effect that mirrors
            // it) would actually land. Reading from nodesRef here would almost
            // always see the pre-result stale state.
            const executionResults = new Map<string, { ok: boolean; status?: number; message: string; signature?: string }>()
            // Keyed by Branch Reset node id — persists across an entire Run, since
            // a single Branch Reset node can be re-entered many times via its own
            // cycle-back edge (that's the whole point of the node).
            const resetCounts = new Map<string, number>()
            // Named variables, resolved via {{name}} in a Data node's custom
            // fields. ANY renamed node auto-sets a variable under its own
            // displayName — a baseline of its own config, walk() dispatches
            // below merge in richer result fields (signature, bundle id,
            // wallets, ...) for the subset that calls a real API. A Set
            // Variable node additionally sets an explicitly-named variable.
            const variables = new Map<string, unknown>()
            const setVariable = (name: string | undefined, value: unknown) => {
                const trimmed = name?.trim()
                if (trimmed) variables.set(trimmed, value)
            }
            // Auto-set variables are named after a node's own displayName (the
            // existing rename-on-click label) — rename a node to make its
            // result referenceable as {{thatName}}. Unnamed nodes still get a
            // stable fallback so nothing collides, though it isn't human-typeable.
            const varNameFor = (nodeId: string) => {
                const data = nodesRef.current.find((n) => n.id === nodeId)?.data as unknown as BuilderNodeData | undefined
                return data?.displayName?.trim() || `${data?.label ?? 'node'}-${nodeId.slice(0, 4)}`
            }

            const sync = () => setNodes((nds) => nds.map((n) => ({ ...n, selected: activeIds.has(n.id) })))
            const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))
            const waitForContinue = (nodeId: string) =>
                new Promise<void>((resolve) => {
                    hitlWaitingRef.current.set(nodeId, resolve)
                    setNodes((nds) => nds.map((n) => (n.id === nodeId ? { ...n, data: { ...n.data, awaitingContinue: true } } : n)))
                })
            const countdown = (nodeId: string, totalSeconds: number) =>
                new Promise<void>((resolve) => {
                    let remaining = Math.max(0, Math.round(totalSeconds))
                    const tick = () => {
                        if (remaining <= 0) {
                            setNodes((nds) => nds.map((n) => (n.id === nodeId ? { ...n, data: { ...n.data, runCountdown: undefined } } : n)))
                            resolve()
                            return
                        }
                        setNodes((nds) => nds.map((n) => (n.id === nodeId ? { ...n, data: { ...n.data, runCountdown: remaining } } : n)))
                        remaining -= 1
                        setTimeout(tick, 1000)
                    }
                    tick()
                })

            // Finds the Data node feeding this Webhook node, builds its payload,
            // POSTs it to the existing webhook execute API, and waits for the
            // response before the branch continues downstream.
            const callWebhook = async (nodeId: string, webhookConfig: Record<string, unknown>) => {
                const url = (webhookConfig.url as string | undefined)?.trim()
                if (!url) {
                    console.warn(`[launch-builder] Webhook node ${nodeId} has no URL configured — skipping call.`)
                    setNodes((nds) => nds.map((n) => (n.id === nodeId
                        ? { ...n, data: { ...n.data, executionResult: { ok: false, message: 'No URL configured' } } }
                        : n)))
                    return
                }

                const inEdge = edgesRef.current.find((e) => e.target === nodeId && e.targetHandle !== 'exec-in')
                const dataNode = inEdge ? nodesRef.current.find((n) => n.id === inEdge.source) : undefined
                if (!dataNode) {
                    console.warn(`[launch-builder] Webhook node ${nodeId} has no Data node connected — sending an empty payload.`)
                }
                const dataNodeData = dataNode?.data as unknown as BuilderNodeData | undefined
                const payload = dataNode
                    ? buildDataNodePayload(dataNodeData?.config ?? {})
                    : {}

                // A bare "{{name}}" or "{{name.path}}" field value is resolved
                // against the named variable store — substituting the raw
                // value (so a wallet-group variable comes through as a real
                // array/object, not a stringified blob). Anything else is
                // left as a literal string; no partial in-string interpolation.
                for (const key of Object.keys(payload)) {
                    const raw = payload[key]
                    if (typeof raw !== 'string') continue
                    const match = /^\{\{\s*([^{}]+?)\s*\}\}$/.exec(raw.trim())
                    if (!match) continue
                    const [varKey, ...path] = match[1].split('.')
                    let resolved: unknown = variables.get(varKey)
                    for (const segment of path) {
                        resolved = (resolved as Record<string, unknown> | undefined)?.[segment]
                    }
                    if (resolved !== undefined) payload[key] = resolved
                }

                try {
                    const res = await fetch('/api/launch-builder/webhook/execute', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            url,
                            authType: webhookConfig.authType ?? 'none',
                            authValue: webhookConfig.authValue ?? '',
                            customHeaders: webhookConfig.customHeaders ?? [],
                            payload,
                        }),
                    })
                    const result = await res.json()
                    console.log(`[launch-builder] Webhook POST ${url} →`, { status: res.status, ok: res.ok, payload, response: result })

                    setNodes((nds) => nds.map((n) => (n.id === nodeId
                        ? {
                            ...n,
                            data: {
                                ...n.data,
                                executionResult: res.ok
                                    ? { ok: true, status: result.status, message: `${result.status} OK` }
                                    : { ok: false, status: result.status, message: result.error ?? `HTTP ${res.status}` },
                            },
                        }
                        : n)))
                } catch (err) {
                    console.error(`[launch-builder] Webhook POST ${url} failed`, err)
                    setNodes((nds) => nds.map((n) => (n.id === nodeId
                        ? { ...n, data: { ...n.data, executionResult: { ok: false, message: String(err) } } }
                        : n)))
                }
            }

            const setResult = (nodeId: string, result: { ok: boolean; status?: number; message: string; signature?: string }) => {
                executionResults.set(nodeId, result)
                setNodes((nds) => nds.map((n) => (n.id === nodeId ? { ...n, data: { ...n.data, executionResult: result } } : n)))
            }

            // A trade node reads REAL on-chain bonding-curve state to price a
            // buy (pump-sdk's fetchBuyState) — that's a plain RPC read, not
            // something dryRun can simulate around. A simulated Launch never
            // broadcasts, so it never actually creates that account, and any
            // downstream trade against the same token hits this. Surface the
            // real cause instead of a bare SDK error string.
            const explainTradeError = (message: string | undefined): string => {
                if (message && /bonding curve account not found/i.test(message)) {
                    return `${message} — this token hasn't actually been created on-chain (a simulated Launch never broadcasts). Test trades against a token that's already been launched for real.`
                }
                return message ?? 'Unknown error'
            }

            // Launch Type — "Dev 0 (Dev Only)" and "Dev 0 (Dev + Bundle)" both have real
            // execution paths server-side (single dev-wallet buy, or dev+up to 4 more
            // wallets landing atomically in one Jito bundle). Real keys are loaded and
            // every transaction is signed either way; testMode simulates instead of
            // broadcasting and never touches the draft's DB status.
            const callLaunch = async (nodeId: string, config: Record<string, unknown>) => {
                const tokenData = findTokenNodeData(nodeId, nodesRef.current, edgesRef.current)
                const tokenId = tokenData?.config?.tokenId as string | undefined
                if (!tokenId) {
                    console.warn(`[launch-builder] Launch node ${nodeId} has no Token node connected — skipping.`)
                    setResult(nodeId, { ok: false, message: 'No Token node connected' })
                    return
                }

                // Start watching BEFORE firing the launch, not after. The create(+buy)
                // transaction — and every wallet bundled into it, for a Dev+Bundle launch —
                // lands and finalizes on-chain during the POST below; if the trade feed's
                // subscription only starts once that response comes back, it's watching a
                // mint whose launch trade(s) already happened. Solana's logsSubscribe is
                // forward-only — there's no backfill for logs that occurred before the
                // subscription existed — so those trades would be permanently invisible,
                // not just delayed. The mint address is already known from the Token node,
                // no need to wait for the launch response to have it.
                if (!testModeRef.current) {
                    const mintAddress = tokenData?.config?.tokenMint as string | undefined
                    const tokenSymbol = (tokenData?.config?.tokenSymbol as string | undefined) ?? null
                    if (mintAddress) setLaunchedToken({ mintAddress, tokenSymbol })
                }

                const payload = {
                    launchConfig: {
                        launchType: LaunchType.block0,
                        token: { id: tokenId },
                        totalSOLInLamports: String(config.totalSOLInLamports ?? '0'),
                        tokensTotal: '0',
                        percentOfSupply: '0',
                        marketCap: '0',
                        walletTrades: config.walletTrades ?? [],
                    },
                    dryRun: testModeRef.current,
                    // Only load-bearing for "Dev 0 (Dev + Bundle)" (>1 wallet) — the
                    // server ignores both for create-only / solo-dev-buy launches.
                    jitoTipInLamports: jitoTipLamportsFromConfig(config),
                    slippage: (config.slippage as number | undefined) ?? 0.05,
                }

                try {
                    const res = await fetch('/api/pumpfun/launch', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(payload),
                    })
                    const result = await res.json()
                    console.log(`[launch-builder] Launch POST /api/pumpfun/launch →`, { status: res.status, ok: res.ok, payload, response: result })

                    // launchStatus/hint (e.g. "current status: launching — only draft tokens
                    // can be launched") used to be silently dropped here — result.error alone
                    // ("Token cannot be launched") gives no way to tell "stuck from an
                    // interrupted attempt" apart from "genuinely already launched."
                    const errorMessage = result.launchStatus
                        ? `${explainTradeError(result.error)} — current status: ${result.launchStatus}${result.hint ? ` (${result.hint})` : ''}`
                        : explainTradeError(result.error)

                    setResult(nodeId, res.ok
                        ? {
                            ok: true,
                            message: result.alreadyLaunched
                                ? 'Already launched — treated as confirmed'
                                : result.simulated ? 'Simulated OK' : `Launched — ${String(result.signature ?? '').slice(0, 10)}…`,
                            signature: result.signature,
                        }
                        : { ok: false, message: errorMessage })
                    if (res.ok) {
                        setVariable(varNameFor(nodeId), { ...config, signature: result.signature, tokenMint: tokenData?.config?.tokenMint })
                    }
                } catch (err) {
                    console.error(`[launch-builder] Launch call failed`, err)
                    setResult(nodeId, { ok: false, message: String(err) })
                }
            }

            // Staggered Buy/Sell — mirrors the schedule pattern already used by
            // the standalone staggered-buy-wizard: shuffle selected wallets,
            // hit the trade one wallet at a time with a randomized delay between.
            const callStaggeredTrade = async (nodeId: string, subtype: 'staggeredBuy' | 'staggeredSell' | 'sellPercent', config: Record<string, unknown>) => {
                const tokenData = findTokenNodeData(nodeId, nodesRef.current, edgesRef.current)
                const mintAddress = tokenData?.config?.tokenMint as string | undefined
                const selectedWalletIds = (config.selectedWalletIds as string[] | undefined) ?? []

                if (!mintAddress) {
                    setResult(nodeId, { ok: false, message: 'No Token node connected' })
                    return
                }
                if (selectedWalletIds.length === 0) {
                    setResult(nodeId, { ok: false, message: 'No wallets selected' })
                    return
                }

                const tradeAmounts = (config.tradeAmounts as Record<string, string> | undefined) ?? {}
                const slippage = (config.slippage as number | undefined) ?? 0.05
                const sellPct = config.sellPct as number | undefined
                // Only the two Staggered nodes spread wallets out with a randomized
                // delay — Sell Percent fires sequentially with no gap.
                const isStaggered = subtype === 'staggeredBuy' || subtype === 'staggeredSell'
                const delayMinMs = Number(config.delayMinSeconds ?? 5) * 1000
                const delayMaxMs = Number(config.delayMaxSeconds ?? 30) * 1000

                // Stratified interleave, not a plain shuffle — same as the wizard.
                // Spreads large trade amounts evenly across the run instead of
                // leaving it to chance whether they cluster together; a
                // monotonic size ramp in either direction is itself a
                // detectable pattern to sniper/copy-trade bots.
                const order = stratifiedInterleave(
                    selectedWalletIds,
                    (id) => parseFloat(tradeAmounts[id] ?? '0') || 0,
                )
                const endpoint = subtype === 'staggeredBuy' ? '/api/trade/staggered/buy' : '/api/trade/staggered/sell'
                let failCount = 0
                let lastSignature: string | undefined
                let lastError: string | undefined

                const autoCommentEnabled = subtype === 'staggeredBuy' && ((config.autoCommentEnabled as boolean | undefined) ?? false)
                const autoComment = autoCommentEnabled ? {
                    enabled:     true,
                    delayMinMs:  (Number(config.autoCommentDelayMinSec) || 180) * 1000,
                    delayMaxMs:  (Number(config.autoCommentDelayMaxSec) || 1800) * 1000,
                    probability: (Number(config.autoCommentProbabilityPct) || 100) / 100,
                    bankIds:     (config.autoCommentBankIds as string[] | undefined) ?? [],
                } : undefined

                // Front-running auto-halt — only meaningful for the two Staggered
                // subtypes, which have a real gap between trades to react in;
                // Sell Percent fires with no gap, same reasoning that already
                // excludes the Bundled Jito loop (see its own comment above).
                const haltEnabled = isStaggered && ((config.autoHaltEnabled as boolean | undefined) ?? false)
                const haltThresholdCount = Math.max(1, Number(config.haltThreshold) || 2)
                const haltWindowMs = Math.max(1, Number(config.haltWindowSec) || 10) * 1000
                let haltedEarly = false

                if (haltEnabled) {
                    // Awaited, not fire-and-forget — a safety feature that's watching
                    // for early snipers can't afford the race window of firing the
                    // first trade before the relay subscription is actually live.
                    await fetch('/api/wss/tokens/watch', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ mint: mintAddress }),
                    }).catch(() => {})

                    autoHaltRunsRef.current.set(nodeId, {
                        mintAddress,
                        ourWalletKeys: new Set(
                            order
                                .map((id) => walletIdToPublicKeyRef.current.get(id))
                                .filter((k): k is string => !!k),
                        ),
                        thresholdCount: haltThresholdCount,
                        windowMs: haltWindowMs,
                        foreignTimestamps: [],
                        triggered: false,
                    })
                }

                let ranCount = 0
                for (let i = 0; i < order.length; i++) {
                    if (haltEnabled && autoHaltRunsRef.current.get(nodeId)?.triggered) {
                        haltedEarly = true
                        break
                    }

                    const walletId = order[i]
                    const body = subtype === 'staggeredBuy'
                        ? {
                            walletId,
                            mintAddress,
                            solAmountLamports: Math.round((parseFloat(tradeAmounts[walletId] ?? '0') || 0) * 1e9).toString(),
                            slippage,
                            dryRun: testModeRef.current,
                            autoComment,
                        }
                        : {
                            walletId,
                            mintAddress,
                            tokenAmount: tradeAmounts[walletId] ?? '0',
                            slippage,
                            sellPct,
                            dryRun: testModeRef.current,
                        }

                    try {
                        const res = await fetch(endpoint, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify(body),
                        })
                        const result = await res.json()
                        console.log(`[launch-builder] ${subtype} POST ${endpoint} wallet=${walletId} →`, { status: res.status, result })
                        if (!res.ok || result.success === false) {
                            failCount++
                            lastError = result.error ?? `HTTP ${res.status}`
                        } else if (result.signature) {
                            lastSignature = result.signature
                        }
                    } catch (err) {
                        console.error(`[launch-builder] ${subtype} call failed wallet=${walletId}`, err)
                        failCount++
                        lastError = String(err)
                    }
                    ranCount++

                    if (isStaggered && i < order.length - 1) {
                        await wait(delayMinMs + Math.random() * (delayMaxMs - delayMinMs))
                    }
                }

                if (haltEnabled) {
                    autoHaltRunsRef.current.delete(nodeId)
                    void fetch('/api/wss/tokens/unwatch', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ mint: mintAddress }),
                    }).catch(() => {})
                }

                if (haltedEarly) {
                    setResult(nodeId, {
                        ok: false,
                        message: `Halted after ${ranCount}/${order.length} — front-running protection triggered${failCount ? `, ${failCount} failed` : ''}`,
                        signature: lastSignature,
                    })
                } else {
                    setResult(nodeId, failCount === 0
                        ? { ok: true, message: `${order.length}/${order.length} ${testModeRef.current ? 'simulated' : 'landed'}`, signature: lastSignature }
                        : { ok: false, message: `${failCount}/${order.length} failed — ${explainTradeError(lastError)}` })
                }
                if (failCount === 0 && !haltedEarly) setVariable(varNameFor(nodeId), { ...config, signature: lastSignature, walletIds: order })
            }

            // Bundled Jito — QuickNode/Lil Jito path only, per scope. Wallets come
            // from the pasted "Copy Launch Totals" JSON (config.bundledWallets, in
            // sequential launch order), chunked into config.bundleSize-wallet Jito
            // bundles and submitted one bundle at a time — this is "the loop."
            // No artificial gap between bundles: /api/trade/bundle/buy's QuickNode
            // path already blocks inside sendPrebuiltBundle → pollBundleStatus until
            // the bundle lands (or throws on Failed/timeout) before responding, so
            // the awaited fetch below IS the confirmation wait — the next bundle
            // fires the instant we have that bundle id back.
            const callBundledTrade = async (nodeId: string, config: Record<string, unknown>) => {
                const tokenData = findTokenNodeData(nodeId, nodesRef.current, edgesRef.current)
                const mintAddress = tokenData?.config?.tokenMint as string | undefined
                const bundledWallets = (config.bundledWallets as ParsedBundledWallet[] | undefined) ?? []
                const bundleSize = Math.max(1, (config.bundleSize as number | undefined) ?? 5)
                const slippage = (config.slippage as number | undefined) ?? 0.05

                if (!mintAddress) {
                    setResult(nodeId, { ok: false, message: 'No Token node connected' })
                    return
                }
                if (bundledWallets.length === 0) {
                    setResult(nodeId, { ok: false, message: 'No wallets parsed — paste the Launch Totals JSON in the node config' })
                    return
                }

                const resolved = bundledWallets.filter((w): w is ParsedBundledWallet & { walletId: string } => !!w.walletId)
                const unmatchedCount = bundledWallets.length - resolved.length
                if (resolved.length === 0) {
                    setResult(nodeId, { ok: false, message: 'None of the pasted wallets matched a known wallet' })
                    return
                }

                const chunks: (typeof resolved)[] = []
                for (let i = 0; i < resolved.length; i += bundleSize) {
                    chunks.push(resolved.slice(i, i + bundleSize))
                }

                const jitoTipInLamports = jitoTipLamportsFromConfig(config)

                const autoCommentEnabled = (config.autoCommentEnabled as boolean | undefined) ?? false
                const autoComment = autoCommentEnabled ? {
                    enabled:     true,
                    delayMinMs:  (Number(config.autoCommentDelayMinSec) || 180) * 1000,
                    delayMaxMs:  (Number(config.autoCommentDelayMaxSec) || 1800) * 1000,
                    probability: (Number(config.autoCommentProbabilityPct) || 100) / 100,
                    bankIds:     (config.autoCommentBankIds as string[] | undefined) ?? [],
                } : undefined

                // Local mirror of the dialog's rows — synchronous source of truth
                // (React state updates are async/batched), pushed to the dialog via
                // setBundleLoop after every mutation.
                const rows: BundleLoopRow[] = chunks.map((chunk) => ({
                    wallets:   chunk.map((w) => ({ label: w.label, publicKey: w.publicKey })),
                    amountSol: chunk.reduce((s, w) => s + w.buyAmountSol, 0),
                    status:    'pending',
                }))
                function pushRows(pausedIndex: number | null, done = false) {
                    setBundleLoop({ nodeId, rows: [...rows], pausedIndex, done })
                }
                pushRows(null)

                // Fires one bundle's full submit-and-confirm cycle. Bundles are launched
                // back-to-back with no gap between them (see the dispatch loop below) —
                // waiting for bundle N to fully land before even building bundle N+1 used
                // to leave a multi-second window where bundle N's trades were already
                // visible on-chain but bundle N+1 hadn't been submitted yet, wide enough
                // for a sniper to react in between. Now every bundle races to land as
                // close together as possible instead.
                async function fireBundle(b: number): Promise<void> {
                    const chunk = chunks[b]
                    const tradesList = chunk.map((w) => ({
                        walletId: w.walletId,
                        mintAddress,
                        amountInSol: Math.round(w.buyAmountSol * 1e9).toString(),
                        slippage,
                    }))

                    rows[b] = { ...rows[b], status: 'running', error: undefined }
                    pushRows(null)

                    let landed = false
                    let bundleId: string | undefined
                    let errorMsg: string | undefined

                    try {
                        const res = await fetch('/api/trade/bundle/buy', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                                jitoTipInLamports,
                                tradesList,
                                useQuicknodeJito: true,
                                dryRun: testModeRef.current,
                                autoComment,
                            }),
                        })
                        const result = await res.json()
                        console.log(`[launch-builder] Bundled Jito loop bundle ${b + 1}/${chunks.length} POST /api/trade/bundle/buy →`, { status: res.status, result })

                        if (res.ok) {
                            landed = true
                            bundleId = result.bundleId
                        } else {
                            errorMsg = explainTradeError(result.error)
                        }
                    } catch (err) {
                        console.error(`[launch-builder] Bundled Jito loop bundle ${b + 1}/${chunks.length} failed`, err)
                        errorMsg = explainTradeError(String(err))
                    }

                    if (landed) {
                        rows[b] = { ...rows[b], status: 'landed', bundleId }
                    } else {
                        rows[b] = { ...rows[b], status: 'failed', error: errorMsg }
                    }
                    pushRows(null)
                }

                // Dispatch every bundle in order, but only wait for each one to be
                // *initiated* (not landed) before starting the next — a tiny stagger
                // between fires, not a confirmation gate. Genuine microsecond timing
                // isn't achievable through a browser JS timer (setTimeout floors out
                // around 1-4ms), so FIRE_STAGGER_MS is the practical equivalent: just
                // enough to keep dispatch order deterministic and avoid slamming the
                // RPC/Jito endpoint with N simultaneous requests, nowhere near enough
                // for a sniper to react in between (unlike the old design, which waited
                // out each bundle's full multi-second landing confirmation in between).
                const FIRE_STAGGER_MS = 15
                setResult(nodeId, { ok: true, message: `Firing ${chunks.length} bundle${chunks.length !== 1 ? 's' : ''}…` })
                const firing: Promise<void>[] = []
                for (let b = 0; b < chunks.length; b++) {
                    firing.push(fireBundle(b))
                    if (b < chunks.length - 1) await new Promise((r) => setTimeout(r, FIRE_STAGGER_MS))
                }
                await Promise.allSettled(firing)

                // Anything that didn't land gets a chance to retry (or skip), one at a
                // time — everything that DID land is already done, no further waiting.
                const failedIndexes = rows.map((r, i) => (r.status === 'failed' ? i : -1)).filter((i) => i !== -1)
                let f = 0
                while (f < failedIndexes.length) {
                    const b = failedIndexes[f]
                    pushRows(b)
                    setResult(nodeId, { ok: false, message: `Bundle ${b + 1}/${chunks.length} failed — ${rows[b].error}` })

                    const action = await new Promise<'retry' | 'skip'>((resolve) => {
                        bundleLoopDecisionRef.current.set(nodeId, resolve)
                    })
                    bundleLoopDecisionRef.current.delete(nodeId)

                    if (action === 'retry') {
                        await fireBundle(b)
                        if (rows[b].status === 'landed') f++ // landed — move to the next failed bundle
                        // still failed — loop again and re-prompt for this same bundle
                    } else {
                        f++ // skip — leave this row marked failed, move to the next one
                    }
                }

                const landedCount = rows.filter((r) => r.status === 'landed').length
                const failCount   = rows.filter((r) => r.status === 'failed').length
                const bundleIds   = rows.filter((r) => r.status === 'landed' && r.bundleId).map((r) => r.bundleId!)
                pushRows(null, true)

                const unmatchedNote = unmatchedCount > 0 ? ` (${unmatchedCount} unmatched wallet${unmatchedCount !== 1 ? 's' : ''} skipped)` : ''
                // Jito bundles don't have a single tx signature — the last-landed bundle
                // id is the closest analog for a downstream confirmation to reference.
                setResult(nodeId, failCount === 0
                    ? { ok: true, message: `${landedCount}/${chunks.length} bundle${chunks.length !== 1 ? 's' : ''} ${testModeRef.current ? 'simulated' : 'landed'}${unmatchedNote}`, signature: bundleIds[bundleIds.length - 1] }
                    : { ok: false, message: `${landedCount}/${chunks.length} bundles landed, ${failCount} failed${unmatchedNote}` })
                if (failCount === 0) setVariable(varNameFor(nodeId), { ...config, bundleIds, walletIds: resolved.map((w) => w.walletId) })
            }

            // Sell All — sells every selected wallet's full balance atomically in
            // one Jito bundle instead of sequentially, so no wallet's sell can be
            // front-run by an earlier one in the same action (each sequential sell
            // drops the price for whoever sells next). Reuses the same bundle-sell
            // route the (buy-only, until now) Bundled Jito node already calls.
            const callBundleSell = async (nodeId: string, config: Record<string, unknown>) => {
                const tokenData = findTokenNodeData(nodeId, nodesRef.current, edgesRef.current)
                const mintAddress = tokenData?.config?.tokenMint as string | undefined
                const selectedWalletIds = (config.selectedWalletIds as string[] | undefined) ?? []

                if (!mintAddress) {
                    setResult(nodeId, { ok: false, message: 'No Token node connected' })
                    return
                }
                if (selectedWalletIds.length === 0) {
                    setResult(nodeId, { ok: false, message: 'No wallets selected' })
                    return
                }

                const slippage = (config.slippage as number | undefined) ?? 0.05
                // No tokenAmount needed — the route resolves each wallet's sell
                // amount from its live on-chain balance at execution time.
                const tradesList = selectedWalletIds.map((walletId) => ({
                    walletId,
                    mintAddress,
                    sellPct: 100,
                    slippage,
                }))

                try {
                    const res = await fetch('/api/trade/bundle/sell', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            jitoTipInLamports: '1000000',
                            tradesList,
                            useQuicknodeJito: true,
                            dryRun: testModeRef.current,
                        }),
                    })
                    const result = await res.json()
                    console.log(`[launch-builder] Sell All POST /api/trade/bundle/sell →`, { status: res.status, result })

                    setResult(nodeId, res.ok
                        ? { ok: true, message: result.simulated ? 'Simulated OK' : 'Bundle landed', signature: result.bundleId }
                        : { ok: false, message: explainTradeError(result.error) })
                    if (res.ok) setVariable(varNameFor(nodeId), { ...config, bundleId: result.bundleId, walletIds: selectedWalletIds })
                } catch (err) {
                    console.error(`[launch-builder] Sell All call failed`, err)
                    setResult(nodeId, { ok: false, message: explainTradeError(String(err)) })
                }
            }

            // Human Volume — a persistent bot, not a single call/response. Start
            // it, let it run a couple of cycles, then fully shut it down so a
            // Run never leaves anything running in the background. The node's
            // config doesn't yet have dedicated funding-wallet / amount-range
            // fields, so those are derived from what's already there — the
            // first selected wallet stands in as the funding wallet, and the
            // buy range is a ±20% band around the average configured amount.
            const callHumanVolume = async (nodeId: string, config: Record<string, unknown>) => {
                const tokenData = findTokenNodeData(nodeId, nodesRef.current, edgesRef.current)
                const mintAddress = tokenData?.config?.tokenMint as string | undefined
                const selectedWalletIds = (config.selectedWalletIds as string[] | undefined) ?? []

                if (!mintAddress) {
                    setResult(nodeId, { ok: false, message: 'No Token node connected' })
                    return
                }
                if (selectedWalletIds.length === 0) {
                    setResult(nodeId, { ok: false, message: 'No wallets selected' })
                    return
                }

                try {
                    const walletsRes = await fetch('/api/wallets/explorer')
                    const walletsData = await walletsRes.json()
                    const allWallets = (walletsData?.wallets as { id: string; public_key: string }[] | undefined) ?? []
                    const pool = allWallets.filter((w) => selectedWalletIds.includes(w.id))
                    if (pool.length === 0) throw new Error('Selected wallets not found')

                    const fundingWallet = pool[0]
                    const tradeAmounts = (config.tradeAmounts as Record<string, string> | undefined) ?? {}
                    const amounts = pool.map((w) => parseFloat(tradeAmounts[w.id] ?? '0.01') || 0.01)
                    const avgSol = amounts.reduce((a, b) => a + b, 0) / amounts.length
                    const buyMinLamports = Math.max(1, Math.round(avgSol * 0.8 * 1e9))
                    const buyMaxLamports = Math.max(buyMinLamports, Math.round(avgSol * 1.2 * 1e9))

                    const startRes = await fetch('/api/auto/human', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            tokenMint: mintAddress,
                            fundingWallet: { id: fundingWallet.id, publicKey: fundingWallet.public_key },
                            walletsList: pool.map((w) => ({ id: w.id, publicKey: w.public_key })),
                            buyAmountLamports: { min: buyMinLamports, max: buyMaxLamports },
                            sellPercent: { min: 20, max: 50 },
                            dryRun: testModeRef.current,
                        }),
                    })
                    const startResult = await startRes.json()
                    console.log(`[launch-builder] Human Volume start →`, { status: startRes.status, result: startResult })

                    if (!startRes.ok) {
                        setResult(nodeId, { ok: false, message: explainTradeError(startResult.error) })
                        return
                    }

                    // Let it run a couple of cycles, then fully close out.
                    await wait(18_000)

                    const stopRes = await fetch('/api/auto/human?action=shutdown', { method: 'DELETE' })
                    const stopResult = await stopRes.json()
                    console.log(`[launch-builder] Human Volume shutdown →`, { status: stopRes.status, result: stopResult })

                    setResult(nodeId, stopRes.ok
                        ? { ok: true, message: testModeRef.current ? 'Simulated run complete' : 'Run complete' }
                        : { ok: false, message: explainTradeError(stopResult.error) })
                    if (stopRes.ok) {
                        setVariable(varNameFor(nodeId), {
                            ...config,
                            walletIds: pool.map((w) => w.id),
                            wallets: pool.map((w) => ({ id: w.id, publicKey: w.public_key })),
                        })
                    }
                } catch (err) {
                    console.error(`[launch-builder] Human Volume flow failed`, err)
                    setResult(nodeId, { ok: false, message: explainTradeError(String(err)) })
                }
            }

            // Set Variable — resolves the configured wallet selection into live
            // wallet info (and token balances, if a Token node is reachable
            // upstream) and stores it under the configured name, so a Data
            // node's custom field can reference it later as {{name}}.
            const callSetVariable = async (nodeId: string, config: Record<string, unknown>) => {
                const name = (config.variableName as string | undefined)?.trim()
                const selectedWalletIds = (config.selectedWalletIds as string[] | undefined) ?? []

                if (!name) {
                    setResult(nodeId, { ok: false, message: 'No variable name set' })
                    return
                }
                if (selectedWalletIds.length === 0) {
                    setResult(nodeId, { ok: false, message: 'No wallets selected' })
                    return
                }

                try {
                    const walletsRes = await fetch('/api/wallets/explorer')
                    const walletsData = await walletsRes.json()
                    const allWallets = (walletsData?.wallets as { id: string; public_key: string; label: string | null; solana_balance_in_lamports?: string | null }[] | undefined) ?? []
                    const pool = allWallets.filter((w) => selectedWalletIds.includes(w.id))
                    if (pool.length === 0) throw new Error('Selected wallets not found')

                    const tokenData = findTokenNodeData(nodeId, nodesRef.current, edgesRef.current)
                    const mintAddress = tokenData?.config?.tokenMint as string | undefined

                    let tokenBalances: Record<string, string> = {}
                    let decimals = 0
                    if (mintAddress) {
                        const balRes = await fetch('/api/wallet/token-balances', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ mintAddress, walletAddresses: pool.map((w) => w.public_key) }),
                        })
                        if (balRes.ok) {
                            const balData = await balRes.json()
                            tokenBalances = (balData?.balances as Record<string, string> | undefined) ?? {}
                            decimals = (balData?.decimals as number | undefined) ?? 0
                        }
                    }

                    const wallets = pool.map((w) => ({
                        id: w.id,
                        publicKey: w.public_key,
                        label: w.label,
                        solBalanceLamports: w.solana_balance_in_lamports ?? null,
                        ...(mintAddress
                            ? {
                                tokenBalanceRaw: tokenBalances[w.public_key] ?? '0',
                                tokenBalanceUi: Number(tokenBalances[w.public_key] ?? '0') / Math.pow(10, decimals),
                            }
                            : {}),
                    }))

                    setVariable(name, wallets)
                    setResult(nodeId, { ok: true, message: `Set {{${name}}} — ${wallets.length} wallet${wallets.length !== 1 ? 's' : ''}` })
                } catch (err) {
                    console.error(`[launch-builder] Set Variable failed`, err)
                    setResult(nodeId, { ok: false, message: String(err) })
                }
            }

            // Launch/Tx Confirmation — reads the outcome already recorded on the
            // node directly upstream (its executionResult) rather than
            // independently re-verifying on-chain. A passthrough today since the
            // node before it already ran and knows whether it succeeded; the
            // signature is carried along for later steps to reference.
            //
            // Gate is strictly signature-based: a real tx signature (or Jito
            // bundle id) must be present to continue, no matter what the
            // upstream's own `ok` flag says — an "ok" result with nothing to
            // confirm (e.g. a bot run with no discrete signature) doesn't count.
            //
            // Walks backward through the (non-exec) edge chain until it finds a
            // node that actually recorded an executionResult — not just the
            // single immediate predecessor, which might be a pass-through node
            // (a Timer, another Trigger, etc.) that never ran a real call itself.
            const findUpstreamResult = (startNodeId: string) => {
                const seen = new Set<string>()
                let currentId = startNodeId
                while (!seen.has(currentId)) {
                    seen.add(currentId)
                    const inEdge = edgesRef.current.find((e) => e.target === currentId && e.targetHandle !== 'exec-in')
                    if (!inEdge) return undefined
                    if (executionResults.has(inEdge.source)) return executionResults.get(inEdge.source)
                    currentId = inEdge.source
                }
                return undefined
            }

            const checkConfirmation = (nodeId: string): boolean => {
                const upstreamResult = findUpstreamResult(nodeId)

                console.log(`[launch-builder] checkConfirmation(${nodeId})`, {
                    upstreamResult,
                    allResultsSoFar: Array.from(executionResults.entries()),
                    allIncomingEdges: edgesRef.current.filter((e) => e.target === nodeId),
                })

                if (upstreamResult?.signature) {
                    setResult(nodeId, {
                        ok: true,
                        message: `Confirmed — ${upstreamResult.signature.slice(0, 10)}…`,
                        signature: upstreamResult.signature,
                    })
                    return true
                }

                const reason = !upstreamResult ? 'no upstream execution result found' : upstreamResult.message
                console.warn(`[launch-builder] Confirmation node ${nodeId} stopping — no tx signature to confirm (${reason})`)
                setResult(nodeId, { ok: false, message: `No signature to confirm — flow stopped (${reason})` })
                return false
            }

            // Body (output-0) is repeated maxIterations times, each with its own
            // fresh local `visited` so nodes inside it (including a HITL pause)
            // can re-fire every iteration; Done (output-1) runs once afterward
            // through the caller's own `visited`, same as any other node.
            const runLoop = async (nodeId: string, config: Record<string, unknown>, outerVisited: Set<string>) => {
                const bodyTargets = getDownstreamNodeIdsByHandle(nodeId, edgesRef.current, 'output-0')
                const doneTargets = getDownstreamNodeIdsByHandle(nodeId, edgesRef.current, 'output-1')
                const maxIterations = Math.max(1, Number(config.maxIterations ?? 3))

                if (bodyTargets.length === 0) {
                    setResult(nodeId, { ok: false, message: 'No Body branch connected' })
                } else {
                    for (let iter = 1; iter <= maxIterations; iter++) {
                        setResult(nodeId, { ok: true, message: `Looping — iteration ${iter}/${maxIterations}` })
                        const iterationVisited = new Set<string>()
                        await Promise.all(bodyTargets.map((id) => walk(id, iterationVisited)))
                    }
                    setResult(nodeId, { ok: true, message: `Looped ${maxIterations}/${maxIterations} iterations` })
                }

                await Promise.all(doneTargets.map((id) => walk(id, outerVisited)))
            }

            // Branch Reset re-arms and re-runs everything wired downstream of it,
            // every time flow reaches it — including via its own cycle-back edge
            // (its output wired back to an earlier node, e.g. a Human In The Loop
            // trigger). Each pass gets a brand-new `visited` set scoped to just
            // that pass, so nodes it re-triggers (including this Branch Reset
            // node itself, reached again via the cycle) aren't blocked by the
            // generic "already ran this session" guard in walk(). A maxResets
            // safety cap stops it from running forever if the operator never
            // stops looping the branch manually.
            const runBranchReset = async (nodeId: string, config: Record<string, unknown>) => {
                const maxResets = Math.max(1, Number(config.maxResets ?? 10))
                const count = (resetCounts.get(nodeId) ?? 0) + 1
                resetCounts.set(nodeId, count)

                const targets = getDownstreamNodeIds(nodeId, edgesRef.current)
                if (targets.length === 0) {
                    setResult(nodeId, { ok: false, message: 'No downstream branch connected' })
                    return
                }
                if (count > maxResets) {
                    setResult(nodeId, { ok: false, message: `Reset limit reached (${maxResets}/${maxResets}) — branch stopped` })
                    return
                }

                setResult(nodeId, { ok: true, message: `Branch reset ${count}/${maxResets}` })
                const passVisited = new Set<string>()
                await Promise.all(targets.map((id) => walk(id, passVisited)))
            }

            const walk = async (nodeId: string, visited: Set<string>) => {
                if (visited.has(nodeId)) return
                visited.add(nodeId)

                activeIds.add(nodeId)
                sync()

                const data = nodesRef.current.find((n) => n.id === nodeId)?.data as unknown as BuilderNodeData | undefined
                let stopBranch = false
                let handledOwnChildren = false

                // Baseline: ANY named node exposes its own config as {{name}} —
                // not just the subset below that goes on to call a real API.
                // Those call* functions merge in richer result fields
                // (signature, bundle id, wallets, ...) after this, spreading
                // `config` alongside so nothing set here is lost in the merge.
                setVariable(varNameFor(nodeId), { ...data?.config })

                if (data?.subtype === 'launchConfirmation' || data?.subtype === 'txConfirmation') {
                    stopBranch = !checkConfirmation(nodeId)
                } else if (data?.subtype === 'loop') {
                    handledOwnChildren = true
                    await runLoop(nodeId, data.config ?? {}, visited)
                } else if (data?.subtype === 'branchReset') {
                    handledOwnChildren = true
                    await runBranchReset(nodeId, data.config ?? {})
                } else if (data?.subtype === 'humanInTheLoop') {
                    await waitForContinue(nodeId)
                } else if (data?.subtype === 'timerSet') {
                    await countdown(nodeId, Number(data.config?.seconds ?? 5))
                } else if (data?.subtype === 'timerRandomInterval') {
                    const min = Number(data.config?.minSeconds ?? 5)
                    const max = Number(data.config?.maxSeconds ?? 30)
                    const lo = Math.min(min, max)
                    const hi = Math.max(min, max)
                    await countdown(nodeId, lo + Math.random() * (hi - lo))
                } else if (data?.subtype === 'webhook') {
                    await callWebhook(nodeId, data.config ?? {})
                } else if (data?.subtype === 'setVariable') {
                    await callSetVariable(nodeId, data.config ?? {})
                } else if (data?.category === 'token') {
                    // Baseline setVariable() above already covers the raw config
                    // (tokenMint/tokenName/tokenSymbol/devWalletId); this just adds
                    // a friendlier alias for the dev wallet field.
                    setVariable(varNameFor(nodeId), { ...data.config, devWalletPublicKey: data.config?.devWalletId })
                    await wait(RUN_STEP_MS)
                } else if (data?.category === 'launchType' && (data.subtype === 'dev0DevOnly' || data.subtype === 'dev0DevBundle')) {
                    await callLaunch(nodeId, data.config ?? {})
                } else if (data?.category === 'launchType') {
                    // bundled / swarm — no real execution backend yet.
                    setResult(nodeId, { ok: false, message: 'Not executable yet — no backend for this launch type' })
                    await wait(RUN_STEP_MS)
                } else if (data?.category === 'trade' && (data.subtype === 'staggeredBuy' || data.subtype === 'staggeredSell' || data.subtype === 'sellPercent')) {
                    await callStaggeredTrade(nodeId, data.subtype, data.config ?? {})
                } else if (data?.category === 'trade' && data.subtype === 'sellAll') {
                    await callBundleSell(nodeId, data.config ?? {})
                } else if (data?.category === 'trade' && data.subtype === 'bundledJito') {
                    await callBundledTrade(nodeId, data.config ?? {})
                } else if (data?.category === 'trade' && data.subtype === 'humanVolume') {
                    await callHumanVolume(nodeId, data.config ?? {})
                } else if (data?.category === 'trade') {
                    // trendingVolume / holdersMaker — no backend at all yet.
                    setResult(nodeId, { ok: false, message: 'Not executable yet — no backend for this trade type' })
                    await wait(RUN_STEP_MS)
                } else {
                    await wait(RUN_STEP_MS)
                }

                activeIds.delete(nodeId)
                sync()

                if (stopBranch) {
                    console.log(`[launch-builder] Branch stopped at ${nodeId} (subtype: ${data?.subtype})`)
                    return
                }
                if (handledOwnChildren) return

                const children = getDownstreamNodeIds(nodeId, edgesRef.current)
                await Promise.all(children.map((id) => walk(id, visited)))
            }

            const sessionVisited = new Set<string>()
            void Promise.all(entryIds.map((id) => walk(id, sessionVisited)))
        },
        [setNodes],
    )

    const onConnect = useCallback(
        (connection: Connection) => setEdges((eds) => addEdge({ ...connection, type: 'deletable' }, eds)),
        [setEdges],
    )

    const onRenameNode = useCallback(
        (nodeId: string, name: string) => {
            setNodes((nds) =>
                nds.map((n) => {
                    if (n.id !== nodeId) return n
                    const data = n.data as unknown as BuilderNodeData
                    return { ...n, data: { ...data, displayName: name || undefined } }
                }),
            )
        },
        [setNodes],
    )

    const onAddNode = useCallback(
        (node: Node) => {
            const data = node.data as unknown as BuilderNodeData
            const withCallbacks = {
                ...node,
                data: {
                    ...data,
                    onRun: () => runDryRun(node.id),
                    onContinue: () => onContinueNode(node.id),
                    onRename: (name: string) => onRenameNode(node.id, name),
                },
            }
            setNodes((nds) => nds.concat(withCallbacks))
        },
        [setNodes, runDryRun, onContinueNode, onRenameNode],
    )

    const onConfigureNode = useCallback((nodeId: string) => setConfigNodeId(nodeId), [])

    const onDeleteNode = useCallback(
        (nodeId: string) => {
            setNodes((nds) => nds.filter((n) => n.id !== nodeId))
            setEdges((eds) => eds.filter((e) => e.source !== nodeId && e.target !== nodeId))
            setConfigNodeId((current) => (current === nodeId ? null : current))
        },
        [setNodes, setEdges],
    )

    const onSaveConfig = useCallback(
        (nodeId: string, config: Record<string, unknown>) => {
            setNodes((nds) =>
                nds.map((n) => {
                    if (n.id !== nodeId) return n
                    const data = n.data as unknown as BuilderNodeData
                    return { ...n, data: { ...data, config } }
                }),
            )
        },
        [setNodes],
    )

    // ── API callbacks ─────────────────────────────────────────────────────────

    const onSave = useCallback(async (): Promise<string | null> => {
        const launchTypeNode = nodes.find(
            (n) => (n.data as unknown as BuilderNodeData).category === 'launchType',
        )
        const launchType = launchTypeNode
            ? (launchTypeNode.data as unknown as BuilderNodeData).subtype
            : null

        const tokenNode = nodes.find(
            (n) => (n.data as unknown as BuilderNodeData).category === 'token',
        )
        // save_launch_config's p_token_mint_id is a uuid FK into private.token_mints(id) —
        // config.tokenId is that row id. config.tokenMint is the on-chain mint *address*
        // (base58, not a uuid); sending that instead throws "invalid input syntax for
        // type uuid" from Postgres the moment a Token node is actually configured.
        const tokenMintId =
            (tokenNode
                ? ((tokenNode.data as unknown as BuilderNodeData).config?.tokenId as string)
                : null) ?? null

        try {
            const res = await fetch('/api/launch-builder/config/save', {
                method:  'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    id:          configId,
                    name:        profile.name,
                    description: profile.description,
                    launchType,
                    graph:       profile,
                    settings:    {},
                    tokenMintId,
                    status:      'draft',
                }),
            })
            if (!res.ok) return null
            const data = await res.json()
            const newId: string | null = data?.id ?? data?.config_id ?? null
            if (newId) setConfigId(newId)
            return newId
        } catch {
            return null
        }
    }, [nodes, profile, configId])

    const onSaveAsTemplate = useCallback(async (): Promise<boolean> => {
        const launchType = profile.nodes.find((n) => n.category === 'launchType')?.subtype ?? 'dev0DevOnly'
        // Renaming an existing template forks a new row instead of overwriting
        // the one it was loaded from — the original stays intact under its name.
        const renamed = templateId !== null && templateName !== null && profile.name !== templateName
        const idToSave = renamed ? null : templateId
        try {
            const res = await fetch('/api/launch-builder/template/save', {
                method:  'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    id:          idToSave,
                    name:        profile.name,
                    description: profile.description,
                    launchType,
                    graph:       profile,
                    settings:    {},
                }),
            })
            if (!res.ok) return false
            const data = await res.json()
            const newId: string | null = data?.id ?? data?.template_id ?? null
            if (newId) {
                setTemplateId(newId)
                setTemplateName(profile.name)
            }
            return true
        } catch {
            return false
        }
    }, [profile, templateId, templateName])

    const onLoadProfile = useCallback(
        (loadedProfile: LaunchProfile, name: string, source?: { type: 'config' | 'template'; id: string }) => {
            const { nodes: newNodes, edges: newEdges } = applyLaunchProfile(
                loadedProfile,
                (id) => ({
                    onConfigure: () => onConfigureNode(id),
                    onDelete:    () => onDeleteNode(id),
                    onRun:       () => runDryRun(id),
                    onContinue:  () => onContinueNode(id),
                    onRename:    (name: string) => onRenameNode(id, name),
                }),
            )
            setNodes(newNodes)
            setEdges(newEdges)
            setProfileName(name)
            // Remember which saved row we just loaded so the next Save / Save
            // Template updates it in place instead of creating a duplicate.
            setConfigId(source?.type === 'config' ? source.id : null)
            setTemplateId(source?.type === 'template' ? source.id : null)
            setTemplateName(source?.type === 'template' ? name : null)
            setConfigNodeId(null)
        },
        [onConfigureNode, onDeleteNode, runDryRun, onContinueNode, onRenameNode, setNodes, setEdges],
    )

    // ─────────────────────────────────────────────────────────────────────────

    const configNode = nodes.find((n) => n.id === configNodeId) ?? null

    return (
        <div className="flex h-[calc(100vh-3rem)] w-full min-w-0 flex-col">
            <LaunchBuilderToolbar
                profileName={profileName}
                onProfileNameChange={setProfileName}
                profile={profile}
                onSave={onSave}
                onSaveAsTemplate={onSaveAsTemplate}
                onLoadProfile={onLoadProfile}
                testMode={testMode}
                onTestModeChange={setTestMode}
            />
            <div className="flex min-h-0 flex-1 w-full">
                <LaunchBuilderPalette nodes={nodes} />
                <LaunchBuilderCanvas
                    nodes={nodes}
                    edges={edges}
                    onNodesChange={onNodesChange}
                    onEdgesChange={onEdgesChange}
                    onConnect={onConnect}
                    onAddNode={onAddNode}
                    onConfigureNode={onConfigureNode}
                    onDeleteNode={onDeleteNode}
                />
                <NodeConfigDialog
                    node={configNode}
                    nodes={nodes}
                    edges={edges}
                    onOpenChange={(open) => { if (!open) setConfigNodeId(null) }}
                    onSave={onSaveConfig}
                    testMode={testMode}
                />
                <BundleLoopPanel
                    state={bundleLoop}
                    onRetry={onRetryBundle}
                    onSkip={onSkipBundle}
                    onClose={onCloseBundleLoop}
                />
                {launchedToken && (
                    <LaunchTradeFeedPanel
                        key={launchedToken.mintAddress}
                        mintAddress={launchedToken.mintAddress}
                        tokenSymbol={launchedToken.tokenSymbol}
                        ourWallets={ourWallets}
                        ourWalletLabels={ourWalletLabels}
                        // Shares the bottom-right corner with BundleLoopPanel (both w-96) —
                        // offset left so a Bundled Jito trade run right after launch doesn't
                        // stack its progress panel directly on top of the trade feed.
                        positionClassName="bottom-4 right-[26rem]"
                    />
                )}
            </div>
        </div>
    )
}
