import BN from 'bn.js';




export interface ExecuteResult {
  success: boolean;
  signature?: string;
  error?: string;
  solAmount: BN;
  tokenAmount: BN;        // raw token units sold (6 decimals for pump.fun tokens)
  tokensRemaining: BN;    // raw token units not yet sold; retry with this amount if non-zero
  price: number;
}


class JitoExecutor() {


}