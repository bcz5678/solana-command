// lib/supabase/import-vanity-keypairs.ts
// Server-side only — call from an API route, never import on client

import { createAdminClient } from '@/lib/supabase/admin'
import { Keypair }           from '@solana/web3.js'

// Rust solana-keygen exports secretKey as a 64-byte array.
// Format: [byte0, byte1, ..., byte63]
// First 32 bytes = private scalar, last 32 = public key (ed25519).
interface RustKeygenOutput {
  secretKey: number[]   // 64-element array — the only field Rust exports
}

const REQUIRED_SUFFIX = 'pump'

/**
 * Imports vanity keypairs from a JSON file uploaded via a client-side form.
 *
 * Expects multipart/form-data with:
 *   keypairs  — JSON file: array of { secretKey: number[64] }
 *   chain     — (optional) chain identifier, defaults to 'solana'
 *
 * Each keypair is validated for the '${REQUIRED_SUFFIX}' suffix, stored in
 * Supabase Vault, then bulk-registered in the staging table via RPC.
 *
 * @param req - Standard Web API Request from a Next.js POST route handler
 */
export async function importVanityKeypairs(req: Request): Promise<Response> {
  const supabase = createAdminClient()

  // ── Auth: must be super admin ──────────────────────────────────────────────
  const token = req.headers.get('Authorization')?.replace('Bearer ', '')
  const { data: { user } } = await supabase.auth.getUser(token ?? '')
  if (!user) return new Response('Unauthorized', { status: 401 })

  const { data: isAdmin } = await supabase.rpc('is_super_admin')
  if (!isAdmin) return new Response('Forbidden', { status: 403 })

  // ── Parse multipart form upload ────────────────────────────────────────────
  let formData: FormData
  try {
    formData = await req.formData()
  } catch {
    return new Response('Invalid form data', { status: 400 })
  }

  const file  = formData.get('keypairs') as File | null
  const chain = (formData.get('chain') as string) ?? 'solana'

  if (!file) return new Response('Missing keypairs file', { status: 400 })

  let raw: RustKeygenOutput[]
  try {
    raw = JSON.parse(await file.text())
    if (!Array.isArray(raw)) throw new Error('Expected JSON array')
  } catch (e) {
    return new Response(`Invalid JSON: ${(e as Error).message}`, { status: 400 })
  }

  // ── Process each keypair ───────────────────────────────────────────────────
  const results   = { imported: 0, skipped_suffix: 0, skipped_vault: 0 }
  const batchRows: { public_key: string; vault_secret_name: string }[] = []

  for (const entry of raw) {

    if (!Array.isArray(entry.secretKey) || entry.secretKey.length !== 64) {
      console.warn('Skipping malformed entry — secretKey must be 64-byte array')
      continue
    }

    const secretBytes = new Uint8Array(entry.secretKey)

    // Derive keypair — public key is always computed, never trusted from input
    let keypair: Keypair
    try {
      keypair = Keypair.fromSecretKey(secretBytes)
    } catch {
      console.warn('Skipping — invalid secretKey bytes')
      secretBytes.fill(0)
      continue
    }

    const publicKey = keypair.publicKey.toBase58()

    // Verify suffix BEFORE touching Vault
    if (!publicKey.toLowerCase().endsWith(REQUIRED_SUFFIX)) {
      secretBytes.fill(0)
      keypair.secretKey.fill(0)
      results.skipped_suffix++
      continue
    }

    // Deterministic vault name: first 8 + last 8 chars of pubkey
    // e.g. 'vanity_ABC12345_XYZpump_secret'
    const vaultName = `vanity_${publicKey.slice(0, 8)}_${publicKey.slice(-8)}_secret`

    // Store in Vault first — if this fails, nothing enters DB
    const { error: vaultErr } = await supabase.rpc('vault_create_secret', {
      secret:      JSON.stringify(Array.from(secretBytes)),
      name:        vaultName,
      description: `Pump vanity keypair ending in '${REQUIRED_SUFFIX}' — pubkey: ${publicKey}`
    })

    if (vaultErr) {
      // Likely a duplicate name — vault_create_secret fails if name already exists
      console.warn(`Vault store failed for ${publicKey}: ${vaultErr.message}`)
      secretBytes.fill(0)
      keypair.secretKey.fill(0)
      results.skipped_vault++
      continue
    }

    batchRows.push({ public_key: publicKey, vault_secret_name: vaultName })

    secretBytes.fill(0)
    keypair.secretKey.fill(0)
    results.imported++
  }

  // ── Bulk register in staging table ────────────────────────────────────────
  if (batchRows.length === 0) {
    return json({ message: 'No valid keypairs imported', ...results }, 200)
  }

  const { data, error } = await supabase.rpc('import_vanity_keypairs', {
    p_keypairs:    JSON.stringify(batchRows),
    p_chain:       chain,
    p_filename:    file.name,
    p_imported_by: user.id
  })

  if (error) {
    return json({ error: error.message, partial: results }, 500)
  }

  return json({ ...data, ...results }, 200)
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' }
  })
}
