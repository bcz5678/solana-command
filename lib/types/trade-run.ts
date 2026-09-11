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
  // The saved run plan, if any — surface-specific shape (see
  // StaggeredRunParams), NULL for runs predating this column and for
  // surfaces that don't populate it yet. Never returned by get_trade_run(s)
  // — fetched separately via getTradeRunParams() only when actually
  // resuming, since it can be a sizeable JSON blob.
  params:       Record<string, unknown> | null
  created_at:   string
  updated_at:   string
}

// The full reconstructable plan for a staggered_buy/staggered_sell run,
// captured once at kickoff (see buildRunParams() in staggered-buy-wizard.tsx)
// so a lost tab can be picked back up in a fresh one.
export interface StaggeredRunParams {
  tradeType:                    'buy' | 'sell'
  tokenMint:                    string
  tokenName:                    string
  tokenSymbol:                  string
  tokenDecimals:                number
  // The full, original schedule — never trimmed. A resume filters this
  // against trade_run_steps at read time rather than storing a mutated copy.
  schedule:                     { walletId: string; delayMsAfter: number }[]
  tradeAmounts:                 Record<string, string>
  slippage:                     number
  sellPct:                      string
  useJitoBuy:                   boolean
  jitoTipSol:                   string
  autoCommentEnabled:           boolean
  autoCommentDelayMinSec:       string
  autoCommentDelayMaxSec:       string
  autoCommentProbabilityPct:    string
  autoCommentBankIds:           string[]
  autoHaltEnabled:              boolean
  haltThreshold:                string
  haltWindowSec:                string
  testMode:                     boolean
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
