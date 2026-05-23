import { SupabaseClient } from '@supabase/supabase-js'
import { Keypair }        from '@solana/web3.js'

interface VaultInsertResult {
  vaultId:         string
  vaultSecretName: string
  publicKey:       string
}

/**
 * Stores a single vanity keypair secret in Supabase Vault,
 * then registers the public key + vault pointer in the staging table.
 *
 * Caller must obtain `admin` and `userId` via requireSuperAdmin().
 *
 * @param secretKeyArray - 64-byte array exported by Rust keygen
 */
export async function addVanityKeypairToVault(
  admin:          SupabaseClient,
  userId:         string,
  secretKeyArray: number[]
): Promise<VaultInsertResult> {

  // ── 1. Validate input shape ──────────────────────────────
  if (!Array.isArray(secretKeyArray) || secretKeyArray.length !== 64) {
    throw new Error('secretKey must be a 64-element number array')
  }

  // ── 2. Derive public key from secret ────────────────────
  // Never trust a public key from outside — always derive it
  const secretBytes = new Uint8Array(secretKeyArray)
  const keypair     = Keypair.fromSecretKey(secretBytes)
  const publicKey   = keypair.publicKey.toBase58()

  // ── 3. Verify pump suffix ────────────────────────────────
  if (!publicKey.toLowerCase().endsWith('pump')) {
    secretBytes.fill(0)
    keypair.secretKey.fill(0)
    throw new Error(`Public key does not end with 'pump': ${publicKey}`)
  }

  // ── 4. Build deterministic vault name ───────────────────
  const vaultSecretName = `vanity_${publicKey.slice(0, 8)}_${publicKey.slice(-8)}_secret`

  // ── 5. Check for duplicate before inserting ─────────────
  const { data: existing } = await admin
    .schema('vault')
    .from('secrets')
    .select('id, name')
    .eq('name', vaultSecretName)
    .maybeSingle()

  if (existing) {
    secretBytes.fill(0)
    keypair.secretKey.fill(0)
    throw new Error(`Vault secret already exists: ${vaultSecretName}`)
  }

  // ── 6. Store secret in Vault ─────────────────────────────
  const { data: vaultId, error: vaultError } = await admin
    .rpc('vault_create_secret', {
      secret:      JSON.stringify(Array.from(secretBytes)),
      name:        vaultSecretName,
      description: `Pump vanity keypair — pubkey: ${publicKey}`
    })

  // ── 7. Wipe secret bytes immediately after vault store ───
  secretBytes.fill(0)
  keypair.secretKey.fill(0)

  if (vaultError) {
    throw new Error(`Vault insert failed: ${vaultError.message}`)
  }

  // ── 8. Verify vault entry exists ─────────────────────────
  const { data: verify, error: verifyError } = await admin
    .schema('vault')
    .from('secrets')
    .select('id, name')
    .eq('id', vaultId)
    .single()

  if (verifyError || !verify) {
    throw new Error(`Vault verification failed for: ${vaultSecretName}`)
  }

  // ── 9. Register staging record in private.vanity_keypairs ─
  const { error: dbError } = await admin
    .rpc('import_vanity_keypairs', {
      p_keypairs: JSON.stringify([{
        public_key:        publicKey,
        vault_secret_name: vaultSecretName
      }]),
      p_chain:       'solana',
      p_filename:    'manual_insert',
      p_imported_by: userId
    })

  if (dbError) {
    throw new Error(`Staging table insert failed: ${dbError.message}`)
  }

  return {
    vaultId,
    vaultSecretName,
    publicKey
  }
}
