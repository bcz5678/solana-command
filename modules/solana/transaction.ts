// src/solana/transaction.ts

import {
  Connection,
  PublicKey,
  Transaction,
  SystemProgram,
  sendAndConfirmTransaction,
  LAMPORTS_PER_SOL
} from '@solana/web3.js'
import { loadKeypairFromVault, wipeKeypair } from '../../lib/vault/keypair.js'

interface TransferParams {
  walletId:     string          // UUID — DB lookup key
  toPublicKey:  string          // recipient base58 pubkey
  amountSOL:    number          // amount in SOL (converted to lamports)
  rpcEndpoint?: string          // defaults to mainnet
}

interface TxResult {
  signature:  string            // tx hash — safe to store in DB
  slot:       number
  walletId:   string
}

/**
 * Signs and sends a SOL transfer.
 *
 * Secret key is loaded from Vault, used to sign,
 * then wiped — it never appears in logs, return values, or DB.
 */
export async function signAndSendTransfer(
  params: TransferParams
): Promise<TxResult> {

  const rpcUrl    = params.rpcEndpoint ?? Deno.env.get('SOLANA_RPC_URL')!
  const connection = new Connection(rpcUrl, 'confirmed')

  // Load keypair from vault — in memory only
  const keypair = await loadKeypairFromVault(params.walletId)

  try {
    const toPubkey  = new PublicKey(params.toPublicKey)
    const lamports  = Math.round(params.amountSOL * LAMPORTS_PER_SOL)

    // Build transaction
    const transaction = new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: keypair.publicKey,
        toPubkey,
        lamports
      })
    )

    // Sign + send — keypair signs internally, signature is just bytes
    const signature = await sendAndConfirmTransaction(
      connection,
      transaction,
      [keypair],        // keypair used here for signing only
      {
        commitment:          'confirmed',
        preflightCommitment: 'confirmed'
      }
    )

    // Get slot for the record
    const { slot } = await connection.getTransaction(signature) ?? { slot: 0 }

    // ✅ Return only the tx signature — safe to log and store
    return {
      signature,
      slot,
      walletId: params.walletId
    }

  } finally {
    // ✅ Always wipe — even if tx throws
    wipeKeypair(keypair)
  }
}