import { Connection, PublicKey } from '@solana/web3.js'
import { TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID, getAccount, getAssociatedTokenAddressSync } from '@solana/spl-token'
import BN from 'bn.js'

/** Resolve the correct token program for a mint by checking its on-chain owner. */
export async function resolveTokenProgram(connection: Connection, mint: PublicKey): Promise<PublicKey> {
  const info = await connection.getAccountInfo(mint)
  return info?.owner.equals(TOKEN_2022_PROGRAM_ID) ? TOKEN_2022_PROGRAM_ID : TOKEN_PROGRAM_ID
}

/** Raw SPL token balance for a wallet's ATA — 0 if the ATA doesn't exist. No pump-sdk involved. */
export async function getTokenBalance(
  connection: Connection,
  mint: PublicKey,
  owner: PublicKey,
  tokenProgram?: PublicKey,
): Promise<BN> {
  const program = tokenProgram ?? await resolveTokenProgram(connection, mint)
  const ata = getAssociatedTokenAddressSync(mint, owner, true, program)
  try {
    const account = await getAccount(connection, ata, undefined, program)
    return new BN(account.amount.toString())
  } catch {
    return new BN(0)
  }
}

export async function getSolBalance(connection: Connection, owner: PublicKey): Promise<BN> {
  const balance = await connection.getBalance(owner)
  return new BN(balance)
}
