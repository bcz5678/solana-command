// lib/types/trade-run.ts

export type TradeRunSurface  = 'staggered_buy' | 'staggered_sell' | 'bundle_buy' | 'bundle_sell' | 'launch_builder'
export type TradeRunStatus   = 'running' | 'paused' | 'cancelled' | 'done' | 'error'
export type TradeRunControl  = 'none' | 'pause_requested' | 'resume_requested' | 'cancel_requested'
export type TradeRunStepStatus = 'pending' | 'running' | 'success' | 'error' | 'cancelled' | 'skipped'

export interface TradeRun {
  id:           string
  surface:      TradeRunSurface
  mint_address: string | null
  label:        string | null
  status:       TradeRunStatus
  control:      TradeRunControl
  total_steps:  number | null
  created_at:   string
  updated_at:   string
}

export interface TradeRunStep {
  id:         string
  step_key:   string
  step_index: number | null
  wallet_id:  string | null
  status:     TradeRunStepStatus
  amount:     string | null
  signature:  string | null
  error:      string | null
  created_at: string
  updated_at: string
}
