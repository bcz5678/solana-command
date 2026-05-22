// src/solana/keypair.ts

import { Keypair } from '@solana/web3.js'
import { createAdminClient } from '@/lib/supabase/admin';
import bs58 from 'bs58'

interface WalletRecord {
  id:                string
  public_key:        string
  vault_secret_name: string
}

/**
 * Loads a Keypair securely from Vault using the wallet_id as a lookup.
 *
 * Pattern:
 * 1. Fetch vault_secret_name from DB using wallet_id
 * 2. Fetch encrypted secret from Vault using that name
 * 3. Reconstruct Keypair in memory
 * 4. Caller uses keypair, then calls wipeKeypair()
 *
 * @param walletId - UUID from private.wallets table
 */
export async function loadKeypairFromVault(
  walletId: string
): Promise<Keypair> {

  const supabase = createAdminClient()

  // 1. Get vault pointer from DB — not the secret itself
  const { data: wallet, error: walletError } = await supabase
    .from('private.wallets')
    .select('id, public_key, vault_secret_name')
    .eq('id', walletId)
    .eq('is_active', true)
    .single<WalletRecord>()

  if (walletError || !wallet) {
    throw new Error(`Wallet not found: ${walletId}`)
  }

  // 2. Fetch decrypted secret from Vault
  const { data: secret, error: vaultError } = await supabase
    .rpc('vault_read_secret', { secret_name: wallet.vault_secret_name })

  if (vaultError || !secret) {
    throw new Error(`Vault read failed for wallet: ${walletId}`)
  }

  // 3. Decode base58 → Uint8Array → Keypair (all in memory)
  const secretKeyBytes = bs58.decode(secret as string)
  const keypair        = Keypair.fromSecretKey(secretKeyBytes)

  // 4. Verify public key matches DB record — sanity + tamper check
  if (keypair.publicKey.toBase58() !== wallet.public_key) {
    throw new Error('Keypair public key mismatch — vault may be corrupted')
  }

  // 5. Zero out the raw bytes — keypair object holds its own copy
  secretKeyBytes.fill(0)

  return keypair
}

/**
 * Best-effort wipe of keypair after use.
 * JS doesn't guarantee memory clearing but signals intent
 * and prevents accidental serialization.
 */

export function wipeKeypair(keypair: Keypair): void {
  // Overwrite the internal secretKey buffer
  keypair.secretKey.fill(0)
}