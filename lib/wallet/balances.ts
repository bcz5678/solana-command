import { Connection, PublicKey } from '@solana/web3.js'
import type { WalletRecord } from '@/lib/types/wallet'

// getMultipleAccounts is hard-capped at 100 pubkeys per call by the RPC spec
const GET_MULTIPLE_ACCOUNTS_BATCH_SIZE = 100

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = []
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size))
  }
  return chunks
}

/**
 * Fetches SOL balances for a list of wallets, batching RPC calls in groups
 * of 100 pubkeys (getMultipleAccounts' hard limit) and merging the results.
 * Sets solana_balance_in_lamports as a plain number so it survives JSON
 * serialization — clients reconstruct BN via lamportsStringToBN(String(n)).
 * Wallets not yet on-chain (null account) get balance 0.
 */
export async function fetchWalletBalances(
  wallets: WalletRecord[],
  connection: Connection,
): Promise<WalletRecord[]> {
  if (wallets.length === 0) return wallets

  const walletBatches = chunk(wallets, GET_MULTIPLE_ACCOUNTS_BATCH_SIZE)

  const accountBatches = await Promise.all(
    walletBatches.map(batch =>
      connection.getMultipleAccountsInfo(batch.map(w => new PublicKey(w.public_key))),
    ),
  )

  const accounts = accountBatches.flat()

  accounts.forEach((account, i) => {
    (wallets[i] as any).solana_balance_in_lamports = account !== null ? account.lamports : 0
  })

  return wallets
}
