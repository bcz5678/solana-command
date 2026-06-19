import BN from 'bn.js'

export interface ExecuteResult {
  success: boolean
  signature?: string
  error?: string
  solAmount: BN
  tokenAmount: BN        // raw token units — decimals depend on the mint
  tokensRemaining: BN    // always ZERO — kept for API compatibility
  price: number
}
