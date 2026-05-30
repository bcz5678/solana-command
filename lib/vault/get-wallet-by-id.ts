// lib/wallet/keypair.ts

import { createAdminClient } from '@/lib/supabase/admin'
import { Keypair }           from '@solana/web3.js'

/**
 * Fetches a wallet's secret key from Vault by wallet UUID,
 * reconstructs the Keypair in memory.
 *
 * IMPORTANT: Caller must wipe keypair.secretKey.fill(0) after use.
 * Never log, serialize, or persist the returned keypair.
 *
 * @param walletId - UUID from private.wallets.id
 */
export async function getWalletKeypairById(walletId: string): Promise<Keypair> {

  // admin client required — service_role gates this function
  const admin = createAdminClient()

  const { data: secret, error } = await admin
    .rpc('get_wallet_secret_by_id', {
      p_wallet_id: walletId      // uuid — no dot notation, public schema wrapper
    })

  if (error || !secret) {
    throw new Error(
      `Failed to fetch wallet keypair: ${error?.message ?? 'secret not found'}`
    )
  }

  // Reconstruct keypair in memory
  const secretKeyArray = JSON.parse(secret as string) as number[]
  const keypair        = Keypair.fromSecretKey(new Uint8Array(secretKeyArray))

  return keypair
  // ⚠️ Caller must: keypair.secretKey.fill(0) after signing
}