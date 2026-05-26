// lib/wallet/recover.ts
// Entirely client-side — server only provides the encrypted blob

import { Keypair }    from '@solana/web3.js'
import * as bip39     from 'bip39'
import { derivePath } from 'ed25519-hd-key'

interface RecoveryBlob {
  encrypted_seed: string   // base64 ciphertext
  iv:             string   // base64 AES-GCM nonce
  salt:           string   // base64 PBKDF2 salt
  kdf_iterations: number   // 600000
}

/**
 * Full recovery flow:
 * 1. Fetch encrypted blob from server (no password needed server-side)
 * 2. Decrypt client-side with user's password
 * 3. Re-derive keypair from mnemonic
 * 4. Use keypair for signing
 * 5. Wipe all key material from memory
 */
export async function recoverKeypair(
  walletId: string,
  password: string
): Promise<Keypair> {

  // ── 1. Fetch encrypted blob from server ───────────────────
  // Server validates ownership via auth.uid() in the function
  // Server returns ONLY ciphertext — cannot decrypt it
  const res = await fetch('/api/wallets/recovery-blob', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ walletId })
  })

  if (!res.ok) throw new Error('Failed to fetch recovery blob')

  const blob: RecoveryBlob = await res.json()

  // ── 2. Decrypt mnemonic client-side ───────────────────────
  // Password never leaves the browser
  const mnemonic = await decryptMnemonic(
    blob.encrypted_seed,
    blob.iv,
    blob.salt,
    blob.kdf_iterations,
    password
  )

  // ── 3. Re-derive keypair from mnemonic ────────────────────
  const seed    = await bip39.mnemonicToSeed(mnemonic)
  const derived = derivePath("m/44'/501'/0'/0'", seed.toString('hex'))
  const keypair = Keypair.fromSeed(derived.key)

  // ── 4. Wipe intermediates — keypair returned for immediate use
  seed.fill(0)
  derived.key.fill(0)

  return keypair
  // ⚠️ Caller must wipe keypair.secretKey.fill(0) after use
}

async function decryptMnemonic(
  ciphertext:     string,
  iv:             string,
  salt:           string,
  kdfIterations:  number,
  password:       string
): Promise<string> {

  const enc         = new TextEncoder()
  const dec         = new TextDecoder()
  const saltBytes   = Uint8Array.from(atob(salt),       c => c.charCodeAt(0))
  const ivBytes     = Uint8Array.from(atob(iv),         c => c.charCodeAt(0))
  const cipherBytes = Uint8Array.from(atob(ciphertext), c => c.charCodeAt(0))

  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    enc.encode(password),
    'PBKDF2',
    false,
    ['deriveKey']
  )

  const encryptionKey = await crypto.subtle.deriveKey(
    {
      name:       'PBKDF2',
      salt:       saltBytes,
      iterations: kdfIterations,
      hash:       'SHA-256'
    },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['decrypt']
  )

  const plaintext = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: ivBytes },
    encryptionKey,
    cipherBytes
  )

  return dec.decode(plaintext)
}