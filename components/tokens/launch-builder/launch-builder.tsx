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
import { BuilderNodeData } from './types'
import { buildLaunchProfile, applyLaunchProfile, type LaunchProfile } from './launch-profile'
import { getExecEntryNodeIds, getDownstreamNodeIds, getDownstreamNodeIdsByHandle, buildDataNodePayload, findTokenNodeData } from './handle-types'
import { LaunchType } from '@/components/tokens/launch/types'

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

            // Launch Type — only "Dev 0 (Dev Only)" has a real execution path
            // server-side today (single dev-wallet buy). Real keys are loaded
            // and the transaction is signed either way; testMode simulates
            // instead of broadcasting and never touches the draft's DB status.
            const callLaunch = async (nodeId: string, config: Record<string, unknown>) => {
                const tokenData = findTokenNodeData(nodeId, nodesRef.current, edgesRef.current)
                const tokenId = tokenData?.config?.tokenId as string | undefined
                if (!tokenId) {
                    console.warn(`[launch-builder] Launch node ${nodeId} has no Token node connected — skipping.`)
                    setResult(nodeId, { ok: false, message: 'No Token node connected' })
                    return
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
                }

                try {
                    const res = await fetch('/api/pumpfun/launch', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(payload),
                    })
                    const result = await res.json()
                    console.log(`[launch-builder] Launch POST /api/pumpfun/launch →`, { status: res.status, ok: res.ok, payload, response: result })

                    setResult(nodeId, res.ok
                        ? {
                            ok: true,
                            message: result.alreadyLaunched
                                ? 'Already launched — treated as confirmed'
                                : result.simulated ? 'Simulated OK' : `Launched — ${String(result.signature ?? '').slice(0, 10)}…`,
                            signature: result.signature,
                        }
                        : { ok: false, message: explainTradeError(result.error) })
                    if (res.ok) setVariable(varNameFor(nodeId), { ...config, signature: result.signature, tokenMint: tokenData?.config?.tokenMint })
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

                // Shuffle so wallet order isn't predictable on-chain, same as the wizard.
                const order = [...selectedWalletIds].sort(() => Math.random() - 0.5)
                const endpoint = subtype === 'staggeredBuy' ? '/api/trade/staggered/buy' : '/api/trade/staggered/sell'
                let failCount = 0
                let lastSignature: string | undefined
                let lastError: string | undefined

                for (let i = 0; i < order.length; i++) {
                    const walletId = order[i]
                    const body = subtype === 'staggeredBuy'
                        ? {
                            walletId,
                            mintAddress,
                            solAmountLamports: Math.round((parseFloat(tradeAmounts[walletId] ?? '0') || 0) * 1e9).toString(),
                            slippage,
                            dryRun: testModeRef.current,
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

                    if (isStaggered && i < order.length - 1) {
                        await wait(delayMinMs + Math.random() * (delayMaxMs - delayMinMs))
                    }
                }

                setResult(nodeId, failCount === 0
                    ? { ok: true, message: `${order.length}/${order.length} ${testModeRef.current ? 'simulated' : 'landed'}`, signature: lastSignature }
                    : { ok: false, message: `${failCount}/${order.length} failed — ${explainTradeError(lastError)}` })
                if (failCount === 0) setVariable(varNameFor(nodeId), { ...config, signature: lastSignature, walletIds: order })
            }

            // Bundled Jito — QuickNode/Lil Jito path only, per scope.
            const callBundledTrade = async (nodeId: string, config: Record<string, unknown>) => {
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
                const tradesList = selectedWalletIds.map((walletId) => ({
                    walletId,
                    mintAddress,
                    amountInSol: Math.round((parseFloat(tradeAmounts[walletId] ?? '0') || 0) * 1e9).toString(),
                    slippage,
                }))

                try {
                    const res = await fetch('/api/trade/bundle/buy', {
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
                    console.log(`[launch-builder] Bundled Jito POST /api/trade/bundle/buy →`, { status: res.status, result })

                    // Jito bundles don't have a single tx signature — the bundle id
                    // is the closest analog for a downstream confirmation to reference.
                    setResult(nodeId, res.ok
                        ? { ok: true, message: result.simulated ? 'Simulated OK' : 'Bundle landed', signature: result.bundleId }
                        : { ok: false, message: explainTradeError(result.error) })
                    if (res.ok) setVariable(varNameFor(nodeId), { ...config, bundleId: result.bundleId, walletIds: selectedWalletIds })
                } catch (err) {
                    console.error(`[launch-builder] Bundled Jito call failed`, err)
                    setResult(nodeId, { ok: false, message: explainTradeError(String(err)) })
                }
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
                } else if (data?.category === 'launchType' && data.subtype === 'dev0DevOnly') {
                    await callLaunch(nodeId, data.config ?? {})
                } else if (data?.category === 'launchType') {
                    // dev0DevBundle / bundled / swarm — no real execution backend yet.
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
        const tokenMintId =
            (tokenNode
                ? ((tokenNode.data as unknown as BuilderNodeData).config?.tokenMint as string)
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
            </div>
        </div>
    )
}
