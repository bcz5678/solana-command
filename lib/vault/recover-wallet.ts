import { createAdminClient } from "@/lib/supabase/admin";
import { Keypair } from '@solana/web3.js';

import * as bip39 from 'bip39';
import { derivePath } from 'ed25519-hd-key'
import bs58        from 'bs58' 

// src/wallet/recover.ts
// Decryption happens on client — server never sees the password

/**
 * Recovers keypair from encrypted blob using user's password.
 * All decryption happens in browser memory.
 */


const supabase = createAdminClient();

export async function recoverWallet(
  walletId: string,
  password: string
): Promise<Keypair> {

  // 1. Fetch encrypted blob from DB
  const { data, error } = await supabase
    .rpc('get_wallet_recovery', { p_wallet_id: walletId })

  if (error || !data) throw new Error('Recovery data not found')

  // 2. Decrypt on client — password never leaves device
  const mnemonic = await decryptMnemonic(
    data.encrypted_seed,
    data.iv,
    data.salt,
    password
  )

  // 3. Re-derive keypair from mnemonic
  const seed    = await bip39.mnemonicToSeed(mnemonic)
  const derived = derivePath("m/44'/501'/0'/0'", seed.toString('hex'))
  const keypair = Keypair.fromSeed(derived.key)

  // 4. Wipe intermediates
  seed.fill(0)
  derived.key.fill(0)

  return keypair
}

async function decryptMnemonic(
  ciphertext: string,
  iv:         string,
  salt:       string,
  password:   string
): Promise<string> {

  const enc         = new TextEncoder()
  const dec         = new TextDecoder()
  const saltBytes   = Uint8Array.from(atob(salt),   c => c.charCodeAt(0))
  const ivBytes     = Uint8Array.from(atob(iv),     c => c.charCodeAt(0))
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
      iterations: 600_000,
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