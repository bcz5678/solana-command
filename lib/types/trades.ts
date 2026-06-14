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
}

export interface BundleSellBody {
  feePayerWalletId:  string
  jitoTipInLamports: string   // lamports as decimal string — BN can't cross JSON
  tradesList:        SellTokenBody[]
}