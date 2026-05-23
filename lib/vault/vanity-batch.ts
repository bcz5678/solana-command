// src/vault/vanity-batch.ts

import { Keypair }        from '@solana/web3.js'
import { SupabaseClient } from '@supabase/supabase-js'



interface SingleResult {
  publicKey: string
  status:    'imported' | 'skipped' | 'failed'
  filename:  string
  error?:    string
}

interface BatchResult {
  imported:          number
  skipped_suffix:    number
  skipped_duplicate: number
  failed:            number
  results:           SingleResult[]
}

/**
 * Processes a single Shape C keypair file.
 * Input: flat 64-byte number array — one keypair per file.
 * Returns a single result entry.
 */
async function processSingleKeypair(
    supabase: SupabaseClient,
    secretKeyArray: number[],
    filename:       string,
): Promise<{ row: { public_key: string; vault_secret_name: string } | null; result: SingleResult }> {

  // ── 1. Validate 64-byte length ───────────────────────────
  if (secretKeyArray.length !== 64) {
    return {
      row:    null,
      result: {
        publicKey: 'unknown',
        filename,
        status:    'failed',
        error:     `Invalid length: ${secretKeyArray.length} bytes (expected 64)`
      }
    }
  }

  const secretBytes = new Uint8Array(secretKeyArray)
  let   keypair:     Keypair
  let   publicKey:   string

  // ── 2. Derive public key from secret ─────────────────────
  try {
    keypair   = Keypair.fromSecretKey(secretBytes)
    publicKey = keypair.publicKey.toBase58()
  } catch (e) {
    secretBytes.fill(0)
    return {
      row:    null,
      result: {
        publicKey: 'unknown',
        filename,
        status:    'failed',
        error:     `Keypair derivation failed: ${(e as Error).message}`
      }
    }
  }

  // ── 3. Verify pump suffix ────────────────────────────────
  if (!publicKey.toLowerCase().endsWith('pump')) {
    secretBytes.fill(0)
    keypair.secretKey.fill(0)
    return {
      row:    null,
      result: {
        publicKey,
        filename,
        status: 'skipped',
        error:  `Does not end with 'pump' — ends with '${publicKey.slice(-4)}'`
      }
    }
  }

  const vaultSecretName =
    `vanity_${publicKey.slice(0, 8)}_${publicKey.slice(-8)}_secret`

  // ── 4. Check for duplicate in vault ──────────────────────
  // vault schema is not PostgREST-exposed — use the SQL wrapper instead
  // check_vault_secret_exists() is a SECURITY DEFINER function that
  // queries vault.secrets internally and returns a boolean
  const { data: exists, error: dupError } = await supabase
    .rpc('check_vault_secret_exists', { p_name: vaultSecretName })

  if (dupError) {
    secretBytes.fill(0)
    keypair.secretKey.fill(0)
    return {
      row:    null,
      result: {
        publicKey,
        filename,
        status: 'failed',
        error:  `Duplicate check failed: ${dupError.message}`
      }
    }
  }

  if (exists) {
    secretBytes.fill(0)
    keypair.secretKey.fill(0)
    return {
      row:    null,
      result: {
        publicKey,
        filename,
        status: 'skipped',
        error:  'Already in vault'
      }
    }
  }

  // ── 5. Store in vault ────────────────────────────────────
  // Parameter names must match the p_ prefixed args in the SQL wrapper:
  //   public.store_vault_secret(p_secret, p_name, p_description)
  const { data: vaultId, error: vaultError } = await supabase
    .rpc('store_vault_secret', {
      p_secret:      JSON.stringify(Array.from(secretBytes)),
      p_name:        vaultSecretName,
      p_description: `Pump vanity keypair — pubkey: ${publicKey}`
    })

  // Always wipe before checking error
  secretBytes.fill(0)
  keypair.secretKey.fill(0)

  if (vaultError) {
    return {
      row:    null,
      result: {
        publicKey,
        filename,
        status: 'failed',
        error:  `Vault error: ${vaultError.message}`
      }
    }
  }

  return {
    row:    { public_key: publicKey, vault_secret_name: vaultSecretName },
    result: { publicKey, filename, status: 'imported' }
  }
}


/**
 * Imports multiple Shape C keypair files in one batch.
 * Each file is a flat [byte, byte, ...] 64-element JSON array.
 *
 * @param files     - Array of File objects from a multi-file form input
 */
// vanity-batch.ts — update the function signature
export async function importVanityBatch(
  supabase:  SupabaseClient,
  files:     File[],
  importedBy: string        // ← add this
): Promise<BatchResult> {

  const result: BatchResult = {
    imported: 0, skipped_suffix: 0,
    skipped_duplicate: 0, failed: 0,
    results: []
  }

  const batchRows: Array<{
    public_key:        string
    vault_secret_name: string
  }> = []

  for (const file of files) {

    // ── Parse file ─────────────────────────────────────────
    let parsed: unknown
    try {
      parsed = JSON.parse(await file.text())
    } catch (e) {
      result.failed++
      result.results.push({
        publicKey: 'unknown',
        filename:  file.name,
        status:    'failed',
        error:     `JSON parse error: ${(e as Error).message}`
      })
      continue
    }

    // ── Validate Shape C ───────────────────────────────────
    // Must be a flat array of numbers, exactly 64 elements
    if (
      !Array.isArray(parsed)           ||
      parsed.length !== 64             ||
      typeof parsed[0] !== 'number'
    ) {
      result.failed++
      result.results.push({
        publicKey: 'unknown',
        filename:  file.name,
        status:    'failed',
        error:     `Unexpected shape — expected flat 64-byte array, got: ${
          Array.isArray(parsed)
            ? `array[${(parsed as unknown[]).length}] of ${typeof (parsed as unknown[])[0]}`
            : typeof parsed
        }`
      })
      continue
    }

    // ── Process single keypair ─────────────────────────────
    const { row, result: singleResult } =
      await processSingleKeypair(supabase, parsed as number[], file.name)

    result.results.push(singleResult)

    switch (singleResult.status) {
      case 'imported':  result.imported++;          batchRows.push(row!); break
      case 'skipped':
        if (singleResult.error?.includes('pump'))   result.skipped_suffix++
        else                                        result.skipped_duplicate++
        break
      case 'failed':    result.failed++;            break
    }
  }

  // ── Bulk register all vault-stored keys in DB ────────────
// Replace the getUser() call entirely
if (batchRows.length > 0) {
  const filenames = files.map(f => f.name).join(', ')

  const { error: dbError } = await supabase
    .rpc('import_vanity_keypairs', {
      p_keypairs:    batchRows,
      p_chain:       'solana',
      p_filename:    filenames,
      p_imported_by: importedBy    // ← use passed-in userId directly
    })

  if (dbError) {
    throw new Error(`Batch DB insert failed: ${dbError.message}`)
  }
}

  return result
}