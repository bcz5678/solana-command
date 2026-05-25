// lib/wallet/generate.ts
// Runs in the browser — never on the server

import { Keypair }      from '@solana/web3.js'
import * as bip39       from 'bip39'
import { derivePath }   from 'ed25519-hd-key'

export interface GeneratedWallet {
  mnemonic:      string   // shown to user once — never sent to server
  publicKey:     string   // sent to server
  encryptedSeed: string   // sent to server (ciphertext only)
  iv:            string   // sent to server
  salt:          string
  vaultSecretName: string    // sent to server
}

/**
 * Generates a custodial Solana wallet.
 * 1. Derives keypair from mnemonic
 * 2. Stores secretKey in Vault via server route
 * 3. Encrypts mnemonic with user password (client-side)
 * 4. Wipes all key material from memory
 *
 * Password never leaves the browser.
 * Mnemonic never leaves the browser.
 * secretKey exists in memory only during steps 1-2.
 */
export async function generateWallet(
  password: string
): Promise<GeneratedWallet> {

// ── 1. Generate mnemonic + derive keypair ──────────────────
  const mnemonic = bip39.generateMnemonic(256)
  const seed     = await bip39.mnemonicToSeed(mnemonic)
  const derived  = derivePath("m/44'/501'/0'/0'", seed.toString('hex'))
  const keypair  = Keypair.fromSeed(derived.key)
  const pubkey   = keypair.publicKey.toBase58()

  // ── 2. Store secretKey in Vault BEFORE encrypting mnemonic ─
  // If vault store fails, abort entirely — no partial state
  const vaultRes = await fetch('/api/wallets/store-keypair', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      secretKey: Array.from(keypair.secretKey),  // 64-byte array
      publicKey: pubkey
    })
  })

  // Wipe secret key bytes immediately after sending —
  // even if the request failed, we don't keep them in memory
  keypair.secretKey.fill(0)
  seed.fill(0)
  derived.key.fill(0)

  if (!vaultRes.ok) {
    const err = await vaultRes.json()
    throw new Error(`Vault store failed: ${err.error}`)
  }

  const { vaultSecretName } = await vaultRes.json()

  // ── 3. Encrypt mnemonic client-side with user's password ────
  // Server never sees the plaintext mnemonic or the password
  const encrypted = await encryptMnemonic(mnemonic, password)

  return {
    mnemonic,              // caller shows once, then wipes from state
    publicKey:     pubkey,
    encryptedSeed: encrypted.ciphertext,
    iv:            encrypted.iv,
    salt:          encrypted.salt,
    vaultSecretName        // vault pointer — safe to store in DB
  }
}

async function encryptMnemonic(
  mnemonic: string,
  password: string
): Promise<{ ciphertext: string; iv: string; salt: string }> {

  const enc  = new TextEncoder()
  const salt = crypto.getRandomValues(new Uint8Array(32))
  const iv   = crypto.getRandomValues(new Uint8Array(12))

  const keyMaterial = await crypto.subtle.importKey(
    'raw', enc.encode(password), 'PBKDF2', false, ['deriveKey']
  )

  const encryptionKey = await crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: 600_000, hash: 'SHA-256' },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt']
  )

  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    encryptionKey,
    enc.encode(mnemonic)
  )

  const toBase64 = (buf: ArrayBuffer) =>
    btoa(String.fromCharCode(...new Uint8Array(buf)))

  return {
    ciphertext: toBase64(ciphertext),
    iv:         btoa(String.fromCharCode(...iv)),
    salt:       btoa(String.fromCharCode(...salt))
  }
}