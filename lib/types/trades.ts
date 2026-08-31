export interface BuyTokenBody {
    walletId:    string
    mintAddress: string
    amountInSol: string   // lamports as decimal string — BN can't cross JSON
    slippage:    number
}

export interface SellTokenBody {
    walletId:    string
    mintAddress: string
    /** Raw token units — BN can't cross JSON. Omit when sellPct is provided. */
    tokenAmount?: string
    /** 1-100 — resolved against the wallet's live on-chain balance at execution time instead of a fixed tokenAmount. */
    sellPct?:    number
    slippage:    number
}

export interface AutoCommentOptions {
  enabled:      boolean
  delayMinMs:   number
  delayMaxMs:   number
  /** 0-1, fraction of eligible wallets that get a comment scheduled at all. Defaults to 1. */
  probability?: number
}

export interface BundleBuyBody {
  jitoTipInLamports: string   // lamports as decimal string — BN can't cross JSON
  tradesList:        BuyTokenBody[]
  /** Set false to bypass Jito entirely and submit via sendRawTransaction (diagnostic mode) */
  useJito?:          boolean
  /** Set true to use the QuickNode Lil Jito addon executor (single-wallet bundles only) */
  useQuicknodeJito?: boolean
  /** Simulate the bundle and stop — never calls sendBundle. QuickNode path only. */
  dryRun?:           boolean
  /** Schedule an organic-timed pump.fun callout per wallet after a confirmed buy. */
  autoComment?:      AutoCommentOptions
}

export interface BundleSellBody {
  jitoTipInLamports: string   // lamports as decimal string — BN can't cross JSON
  tradesList:        SellTokenBody[]
  /** Set false to bypass Jito entirely and submit via sendRawTransaction (diagnostic mode) */
  useJito?:          boolean
  /** Set true to use the QuickNode Lil Jito addon executor with sequential curve simulation */
  useQuicknodeJito?: boolean
  /** Simulate the bundle and stop — never calls sendBundle. QuickNode path only. */
  dryRun?:           boolean
}


export interface TradeLog {
  id:            string
  wallet_id:     string | null
  wallet_label:  string | null    // joined
  wallet_pubkey: string | null    // joined
  mint_id:       string | null
  token_name:    string | null    // joined
  token_symbol:  string | null    // joined
  exchange:      string
  symbol:        string
  side:          'BUY' | 'SELL'
  order_type:    string
  quantity:      number | null
  price:         number | null
  amount_sol:    number | null
  to_address:    string
  tx_signature:  string | null
  status:        'pending' | 'confirmed' | 'failed' | 'cancelled'
  slippage_bps:  number | null
  price_impact:  number | null
  error_message: string | null
  executed_at:   string
}

export interface TradeStats {
  total_trades:     number
  confirmed_trades: number
  failed_trades:    number
  buy_count:        number
  sell_count:       number
  sol_spent:        number
  sol_received:     number
  net_sol:          number      // received − spent
  first_trade_at:   string | null
  last_trade_at:    string | null
}