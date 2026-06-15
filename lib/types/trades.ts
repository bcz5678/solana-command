export interface BuyTokenBody {
    walletId:    string
    mintAddress: string
    amountInSol: string   // lamports as decimal string — BN can't cross JSON
    slippage:    number
}

export interface SellTokenBody {
    walletId:    string
    mintAddress: string
    tokenAmount: string   // raw token units — BN can't cross JSON
    slippage:    number
}

export interface BundleBuyBody {
  feePayerWalletId:  string
  jitoTipInLamports: string   // lamports as decimal string — BN can't cross JSON
  tradesList:        BuyTokenBody[]
  /** Set false to bypass Jito entirely and submit via sendRawTransaction (diagnostic mode) */
  useJito?:          boolean
  /** Set true to use the QuickNode Lil Jito addon executor (single-wallet bundles only) */
  useQuicknodeJito?: boolean
}

export interface BundleSellBody {
  feePayerWalletId:  string
  jitoTipInLamports: string   // lamports as decimal string — BN can't cross JSON
  tradesList:        SellTokenBody[]
  /** Set false to bypass Jito entirely and submit via sendRawTransaction (diagnostic mode) */
  useJito?:          boolean
  /** Set true to use the QuickNode Lil Jito addon executor with sequential curve simulation */
  useQuicknodeJito?: boolean
}