// lib/wallet/keypair.ts

import { createAdminClient } from '@/lib/supabase/admin'
import { Keypair }           from '@solana/web3.js'

/**
 * Fetches a wallet's secret key from Supabase Vault by wallet UUID
 * and reconstructs the Solana Keypair in memory.
 *
 * SECURITY:
 *  - Uses the admin (service_role) client — get_wallet_secret_by_id()
 *    is gated on auth.role() = 'service_role'.
 *  - The secret key never touches the DB rows directly; it lives in
 *    the encrypted vault and is fetched only at signing time.
 *  - The CALLER MUST wipe the key after use:
 *        keypair.secretKey.fill(0)
 *    Always do this in a finally{} block so it runs on every path.
 *  - Never log, serialize, persist, or return the keypair to a client.
 *
 * @param walletId - UUID from private.wallets.id
 * @returns reconstructed Keypair (caller owns wiping it)
 * @throws if the wallet/secret is not found or the secret is malformed
 */
export async function getWalletKeypairById(walletId: string): Promise<Keypair> {

  if (!walletId) {
    throw new Error('walletId is required')
  }

  const admin = createAdminClient()

  // ── Fetch the decrypted secret from the vault ──────────────
  // get_wallet_secret_by_id():
  //   1. looks up private.wallets.vault_secret_name by UUID
  //   2. reads vault.decrypted_secrets for that name
  //   3. returns the JSON-encoded 64-byte secret key array
  const { data: secret, error } = await admin
    .rpc('get_wallet_secret_by_id', {
      p_wallet_id: walletId
    })

  if (error || !secret) {
    throw new Error(
      `Failed to fetch wallet keypair: ${error?.message ?? 'secret not found'}`
    )
  }

  return reconstructKeypair(secret as string)
  // ⚠️ CALLER MUST: keypair.secretKey.fill(0) after use (in finally{})
}


/**
 * Fetches a vault secret directly by its vault_secret_name.
 * Use when you have the secret name rather than a wallet UUID
 * (e.g. the mint authority key during a token launch).
 *
 * Same security rules apply — caller must wipe the returned keypair.
 *
 * @param vaultSecretName - the name stored in vault.decrypted_secrets
 * @returns reconstructed Keypair
 */
export async function getKeypairByVaultName(
  vaultSecretName: string
): Promise<Keypair> {

  if (!vaultSecretName) {
    throw new Error('vaultSecretName is required')
  }

  const admin = createAdminClient()

  const { data: secret, error } = await admin
    .rpc('get_vault_secret', {
      secret_name: vaultSecretName
    })

  if (error || !secret) {
    throw new Error(
      `Failed to fetch vault secret: ${error?.message ?? 'not found'}`
    )
  }

  return reconstructKeypair(secret as string)
  // ⚠️ CALLER MUST: keypair.secretKey.fill(0) after use
}


/**
 * Shared helper — parses a JSON 64-byte array string into a Keypair.
 * Scrubs the intermediate plaintext array best-effort.
 */
function reconstructKeypair(secretJson: string): Keypair {
  let secretKeyArray: number[]
  try {
    secretKeyArray = JSON.parse(secretJson) as number[]
  } catch {
    throw new Error('Vault secret is not valid JSON — cannot reconstruct keypair')
  }

  if (!Array.isArray(secretKeyArray) || secretKeyArray.length !== 64) {
    throw new Error(
      `Invalid secret key length: ${secretKeyArray?.length ?? 0} (expected 64 bytes)`
    )
  }

  const keypair = Keypair.fromSecretKey(new Uint8Array(secretKeyArray))

  // Best-effort scrub of the intermediate plaintext array.
  // (JS can't guarantee GC timing, but we clear what we can.)
  secretKeyArray.fill(0)

  return keypair
}