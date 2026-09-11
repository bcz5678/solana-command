// lib/trade/trade-run-client.ts
//
// Thin fetch wrappers around /api/trade-runs/* for the three client-driven
// execution surfaces (staggered wizard, bundle wizard, launch builder) to
// call as they progress. Every call swallows its own errors — persisting
// progress must never block or crash the actual trade execution it's
// describing; at worst a step goes unrecorded, which is recoverable, versus
// a stalled trade loop, which isn't.

import type { TradeRun, TradeRunStep, TradeRunSurface, TradeRunStatus, TradeRunControl, TradeRunStepStatus } from '@/lib/types/trade-run'

export async function createTradeRun(
  surface:     TradeRunSurface,
  mintAddress: string | null,
  label:       string | null,
  totalSteps:  number | null,
  params?:     Record<string, unknown> | null,
): Promise<string | null> {
  try {
    const res = await fetch('/api/trade-runs', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ surface, mintAddress, label, totalSteps, params: params ?? null }),
    })
    if (!res.ok) return null
    const data = await res.json()
    return data.runId ?? null
  } catch {
    return null
  }
}

// The saved run plan, fetched once at actual resume time — deliberately a
// separate call from getTradeRun(), which is polled every few seconds for a
// run's whole lifetime just to read `.control`.
export async function getTradeRunParams(runId: string): Promise<Record<string, unknown> | null> {
  try {
    const res = await fetch(`/api/trade-runs/${runId}/params`)
    if (!res.ok) return null
    const data = await res.json()
    return (data.params as Record<string, unknown>) ?? null
  } catch {
    return null
  }
}

export interface TradeRunStepInput {
  stepKey:    string
  stepIndex?: number | null
  walletId?:  string | null
  status:     TradeRunStepStatus
  amount?:    string | null
  signature?: string | null
  error?:     string | null
}

export function upsertTradeRunStep(runId: string | null, step: TradeRunStepInput): void {
  if (!runId) return
  fetch(`/api/trade-runs/${runId}/steps`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(step),
  }).catch(() => {})
}

export async function getTradeRun(runId: string): Promise<TradeRun | null> {
  try {
    const res = await fetch(`/api/trade-runs/${runId}`)
    if (!res.ok) return null
    const data = await res.json()
    return (data.run as TradeRun) ?? null
  } catch {
    return null
  }
}

export async function getTradeRunSteps(runId: string): Promise<TradeRunStep[]> {
  try {
    const res = await fetch(`/api/trade-runs/${runId}/steps`)
    if (!res.ok) return []
    const data = await res.json()
    return (data.steps as TradeRunStep[]) ?? []
  } catch {
    return []
  }
}

export function requestTradeRunControl(runId: string | null, control: TradeRunControl): void {
  if (!runId) return
  fetch(`/api/trade-runs/${runId}/control`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ control }),
  }).catch(() => {})
}

export function finishTradeRun(runId: string | null, status: TradeRunStatus): void {
  if (!runId) return
  fetch(`/api/trade-runs/${runId}/finish`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ status }),
  }).catch(() => {})
}
