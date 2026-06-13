import BN from 'bn.js'

export interface BuyTokenBody {
    walletId:    string
    mintAddress: string
    amountInSol: string   // lamports as decimal string — BN can't cross JSON
    slippage:    number
}



export interface SellTokenBody {
    walletId: string
    mintAddress: string
    tokenAmount: string
    slippage: number
}


export interface BundleBuyBody {
  feePayerWalletId: string
  jitoTipInLamports: BN
  tradesList: BuyTokenBody[]
  lookupTables: 
    // optional initial addresses to add
}

export interface BundleSellBody {
  feePayerWalletId: string
  jitoTipInLamports: BN
  tradesList: BuyTokenBody[]
    // optional initial addresses to add
}