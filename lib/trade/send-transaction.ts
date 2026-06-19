import { Connection, Keypair, TransactionInstruction, TransactionMessage, VersionedTransaction } from '@solana/web3.js'

export interface SignedTransactionBundle {
  tx: VersionedTransaction
  blockhash: string
  lastValidBlockHeight: number
}

/**
 * Build, sign, and send with retry. buildSignedTransaction is re-called on every
 * attempt so each retry gets a fresh blockhash and (for callers that re-derive
 * state, e.g. bonding-curve reserves or a Jupiter quote) fresh pricing.
 */
export async function sendWithRetry(
  connection: Connection,
  buildSignedTransaction: () => Promise<SignedTransactionBundle>,
  maxRetries: number,
): Promise<string> {
  let lastError: Error | undefined

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const { tx, blockhash, lastValidBlockHeight } = await buildSignedTransaction()

      // skipPreflight: simulation uses stale validator state and produces false
      // slippage / blockhash errors. On-chain confirmation is authoritative.
      const signature = await connection.sendTransaction(tx, { skipPreflight: true, maxRetries: 0 })

      const confirmation = await connection.confirmTransaction(
        { signature, blockhash, lastValidBlockHeight },
        'confirmed',
      )

      if (confirmation.value.err) {
        throw new Error(`Transaction failed: ${JSON.stringify(confirmation.value.err)}`)
      }

      return signature
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err))
      if (attempt < maxRetries) {
        console.log(`TX attempt ${attempt + 1} failed: ${lastError.message} — retrying…`)
      }
    }
  }

  throw lastError ?? new Error('Transaction failed after retries')
}

/** Compile + sign a fresh transaction from instructions against the latest blockhash. */
export async function signInstructions(
  connection: Connection,
  wallet: Keypair,
  instructions: TransactionInstruction[],
): Promise<SignedTransactionBundle> {
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed')
  const messageV0 = new TransactionMessage({
    payerKey: wallet.publicKey,
    recentBlockhash: blockhash,
    instructions,
  }).compileToV0Message()

  const tx = new VersionedTransaction(messageV0)
  tx.sign([wallet])
  return { tx, blockhash, lastValidBlockHeight }
}
