// lib/vault/generate-wallet.ts
// Server-side only — requires SUPABASE_SERVICE_ROLE_KEY, never import on client

import { createAdminClient }    from '@/lib/supabase/admin'
import { Keypair }               from '@solana/web3.js'
import * as bip39                from 'bip39'
import { derivePath }            from 'ed25519-hd-key'
import bs58                      from 'bs58'

export interface WalletSetupResult {
  walletId:  string   // UUID — primary key for all future vault lookups
  publicKey: string   // Solana public key (base58) — safe to store anywhere
  mnemonic:  string   // 24-word phrase — show to user ONCE, never log or persist
}

// Vault secret name conventions — used by loadKeypairFromVault() and recovery flows
export const keypairSecretName  = (id: string) => `wallet_${id}_keypair`
export const mnemonicSecretName = (id: string) => `wallet_${id}_mnemonic`

/**
 * Generates a new Solana wallet from a BIP39 mnemonic and registers it
 * in Supabase Vault with two encrypted entries:
 *
 *   wallet_{walletId}_keypair   → bs58-encoded 64-byte secret key  (tx signing)
 *   wallet_{walletId}_mnemonic  → raw 24-word BIP39 phrase          (account recovery)
 *
 * Only the public key and vault name pointers are stored in the DB.
 * The mnemonic is returned once — the caller must display it and discard it.
 *
 * @param userId - Supabase auth user ID this wallet belongs to
 * @param label  - Human-readable label e.g. "Trading Wallet"
 */
export async function createAndRegisterWallet(
  userId: string,
  label:  string
): Promise<WalletSetupResult> {

  const supabase = createAdminClient()
  const walletId = crypto.randomUUID()

  // 1. Generate 24-word BIP39 mnemonic (256-bit entropy)
  const mnemonic = bip39.generateMnemonic(256)

  // 2. Derive Solana keypair via BIP44 path m/44'/501'/0'/0'
  const seed    = await bip39.mnemonicToSeed(mnemonic)
  const derived = derivePath("m/44'/501'/0'/0'", seed.toString('hex'))
  const keypair = Keypair.fromSeed(derived.key)
  const publicKey = keypair.publicKey.toBase58()

  const kpSecretName = keypairSecretName(walletId)
  const mnSecretName = mnemonicSecretName(walletId)

  // 3. Store secret key in Vault (pgsodium encrypted at rest)
  const { error: keypairVaultError } = await supabase.rpc('vault_create_secret', {
    secret:      bs58.encode(keypair.secretKey),
    name:        kpSecretName,
    description: `Solana keypair for wallet ${walletId} — transaction signing`
  })

  if (keypairVaultError) {
    throw new Error(`Vault keypair store failed: ${keypairVaultError.message}`)
  }

  // 4. Store mnemonic in Vault (pgsodium encrypted at rest)
  const { error: mnemonicVaultError } = await supabase.rpc('vault_create_secret', {
    secret:      mnemonic,
    name:        mnSecretName,
    description: `BIP39 mnemonic for wallet ${walletId} — account recovery`
  })

  if (mnemonicVaultError) {
    // Rollback orphaned keypair secret before throwing
    await supabase.rpc('vault_delete_secret', { secret_name: kpSecretName }).catch(() => {})
    throw new Error(`Vault mnemonic store failed: ${mnemonicVaultError.message}`)
  }

  // 5. Store only public metadata + vault name pointers in DB
  const { error: dbError } = await supabase
    .from('private.wallets')
    .insert({
      id:                  walletId,
      user_id:             userId,
      public_key:          publicKey,
      vault_secret_name:   kpSecretName,   // → used by loadKeypairFromVault()
      vault_mnemonic_name: mnSecretName,   // → used by recoverWalletMnemonic()
      label,
      is_active:           true
    })

  if (dbError) {
    // Rollback both vault entries
    await Promise.allSettled([
      supabase.rpc('vault_delete_secret', { secret_name: kpSecretName }),
      supabase.rpc('vault_delete_secret', { secret_name: mnSecretName })
    ])
    throw new Error(`DB insert failed: ${dbError.message}`)
  }

  // 6. Zero out all sensitive material in memory — best effort in JS
  seed.fill(0)
  derived.key.fill(0)
  keypair.secretKey.fill(0)

  return {
    walletId,
    publicKey,
    mnemonic   // caller shows to user once — do not log, store, or return to client
  }
}

/**
 * Retrieves the BIP39 mnemonic from Vault for account recovery.
 * Only call this inside an authenticated server action after verifying
 * the requesting user owns the wallet.
 *
 * @param walletId - UUID from private.wallets
 */
export async function recoverWalletMnemonic(walletId: string): Promise<string> {
  const supabase = createAdminClient()

  const { data: wallet, error: walletError } = await supabase
    .from('private.wallets')
    .select('user_id, vault_mnemonic_name')
    .eq('id', walletId)
    .eq('is_active', true)
    .single()

  if (walletError || !wallet) {
    throw new Error(`Wallet not found: ${walletId}`)
  }

  const { data: mnemonic, error: vaultError } = await supabase
    .rpc('vault_read_secret', { secret_name: wallet.vault_mnemonic_name })

  if (vaultError || !mnemonic) {
    throw new Error(`Vault mnemonic read failed for wallet: ${walletId}`)
  }

  return mnemonic as string
}
