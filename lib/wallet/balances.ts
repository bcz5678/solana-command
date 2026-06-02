import { Connection, PublicKey } from '@solana/web3.js'
import type { WalletRecord } from '@/lib/types/wallet'

/**
 * Fetches SOL balances for a list of wallets in a single batched RPC call.
 * Sets solana_balance_in_lamports as a plain number so it survives JSON
 * serialization — clients reconstruct BN via lamportsStringToBN(String(n)).
 * Wallets not yet on-chain (null account) get balance 0.
 */
export async function fetchWalletBalances(
  wallets: WalletRecord[],
  connection: Connection,
): Promise<WalletRecord[]> {
  if (wallets.length === 0) return wallets

  const publicKeys = wallets.map(w => new PublicKey(w.public_key))
  const accounts   = await connection.getMultipleAccountsInfo(publicKeys)

  accounts.forEach((account, i) => {
    (wallets[i] as any).solana_balance_in_lamports = account !== null ? account.lamports : 0
  })

  return wallets
}
