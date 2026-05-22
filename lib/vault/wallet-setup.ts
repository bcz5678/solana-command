// src/vault/wallet-setup.ts
// One-time setup script — run server side only

import { createAdminClient } from '@/lib/supabase/admin';
import { Keypair } from '@solana/web3.js';
import bs58 from 'bs58';

/**
 * Registers a new wallet:
 * 1. Stores secret key in Supabase Vault (encrypted)
 * 2. Stores only public key + vault pointer in DB
 *
 * @param secretKeyBytes - Uint8Array of the 64-byte keypair
 * @param userId - Supabase user ID this wallet belongs to
 * @param label - Human readable label
 */
export async function registerWallet(
  secretKeyBytes: Uint8Array,
  userId: string,
  label: string
): Promise<string> {

  const supabase  = createAdminClient();

  // Derive public key from secret — never store the secret in DB
  const keypair   = Keypair.fromSecretKey(secretKeyBytes)
  const publicKey = keypair.publicKey.toBase58()

  // Generate a unique vault secret name tied to a wallet ID
  const walletId        = crypto.randomUUID()
  const vaultSecretName = `wallet_${walletId}_keypair`

  // 1. Store secret key in Vault (encrypted at rest)
  const { error: vaultError } = await supabase.rpc('vault_create_secret', {
    secret:      bs58.encode(secretKeyBytes),  // base58 encoded
    name:        vaultSecretName,
    description: `Solana keypair for wallet ${walletId}`
  })

  if (vaultError) throw new Error(`Vault store failed: ${vaultError.message}`)

  // 2. Store only public metadata in DB
  const { error: dbError } = await supabase
    .from('private.wallets')
    .insert({
      id:                walletId,
      user_id:           userId,
      public_key:        publicKey,
      vault_secret_name: vaultSecretName,
      label
    })

  if (dbError) throw new Error(`DB insert failed: ${dbError.message}`)

  // 3. Zero out secret bytes — best effort in JS
  secretKeyBytes.fill(0)

  return walletId
}