import { SupabaseClient } from '@supabase/supabase-js'
import { Keypair }        from '@solana/web3.js'

interface BatchResult {
  imported:          number
  skipped_suffix:    number
  skipped_duplicate: number
  failed:            number
  results:           Array<{ publicKey: string; status: string; error?: string }>
}

/**
 * Processes an array of raw 64-byte secret key arrays (standard Solana keypair JSON format).
 * Public keys are derived here — never trusted from outside.
 *
 * Caller must obtain `admin` and `userId` via requireSuperAdmin().
 *
 * @param entries   - Array of 64-element secret key number arrays
 * @param filename  - Original filename for audit trail
 */
export async function importVanityBatch(
  admin:    SupabaseClient,
  userId:   string,
  entries:  Array<number[]>,
  filename: string
): Promise<BatchResult> {

  const result: BatchResult = {
    imported: 0, skipped_suffix: 0,
    skipped_duplicate: 0, failed: 0,
    results: []
  }

  const batchRows: Array<{ public_key: string; vault_secret_name: string }> = []

  for (const entry of entries) {

    if (!Array.isArray(entry) || entry.length !== 64) {
      result.failed++
      result.results.push({ publicKey: 'unknown', status: 'failed', error: 'Invalid secretKey shape' })
      continue
    }

    const secretBytes = new Uint8Array(entry)
    let   keypair:     Keypair
    let   publicKey:   string

    try {
      keypair   = Keypair.fromSecretKey(secretBytes)
      publicKey = keypair.publicKey.toBase58()
    } catch {
      secretBytes.fill(0)
      result.failed++
      result.results.push({ publicKey: 'unknown', status: 'failed', error: 'Invalid keypair bytes' })
      continue
    }

    if (!publicKey.toLowerCase().endsWith('pump')) {
      secretBytes.fill(0)
      keypair.secretKey.fill(0)
      result.skipped_suffix++
      result.results.push({ publicKey, status: 'skipped', error: 'Missing pump suffix' })
      continue
    }

    const vaultSecretName = `vanity_${publicKey.slice(0, 8)}_${publicKey.slice(-8)}_secret`

    const { error: vaultError } = await admin
      .rpc('vault_create_secret', {
        secret:      JSON.stringify(Array.from(secretBytes)),
        name:        vaultSecretName,
        description: `Pump vanity keypair — pubkey: ${publicKey}`
      })

    // Wipe immediately after vault call regardless of outcome
    secretBytes.fill(0)
    keypair.secretKey.fill(0)

    if (vaultError) {
      if (vaultError.message.includes('duplicate')) {
        result.skipped_duplicate++
        result.results.push({ publicKey, status: 'skipped', error: 'Already in vault' })
      } else {
        result.failed++
        result.results.push({ publicKey, status: 'failed', error: vaultError.message })
      }
      continue
    }

    batchRows.push({ public_key: publicKey, vault_secret_name: vaultSecretName })
    result.results.push({ publicKey, status: 'imported' })
    result.imported++
  }

  if (batchRows.length > 0) {
    const { error: dbError } = await admin
      .rpc('import_vanity_keypairs', {
        p_keypairs:    JSON.stringify(batchRows),
        p_chain:       'solana',
        p_filename:    filename,
        p_imported_by: userId
      })

    if (dbError) {
      throw new Error(`Batch DB insert failed: ${dbError.message}`)
    }
  }

  return result
}
