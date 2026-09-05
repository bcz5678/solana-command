// lib/wallet/retire.ts
//
// On-chain side of wallet retirement: enumerate every token account the
// wallet holds, refuse to proceed if any still has a real balance, close the
// empty ones to reclaim their rent, then sweep the wallet's entire remaining
// SOL balance (original + reclaimed rent) to a destination address. The DB
// side (setting is_active=false, which is what actually locks the wallet out
// — see retire_wallet() in supabase/rpc/retire_wallet.sql) only happens after
// the caller (app/api/wallets/retire/route.ts) re-verifies on-chain that the
// wallet ended up truly empty.

import { Connection, Keypair, PublicKey, SystemProgram, Transaction, sendAndConfirmTransaction } from '@solana/web3.js'
import { TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID, createCloseAccountInstruction } from '@solana/spl-token'
import { getWalletKeypairById } from '@/lib/vault/get-wallet-by-id'
import type { createClient } from '@/lib/supabase/server'

export interface HeldTokenAccount {
  pubkey:    PublicKey
  mint:      string
  programId: PublicKey
  rawAmount: string
  uiAmount:  number
}

/**
 * Every SPL/Token-2022 account this wallet owns, zero-balance or not.
 *
 * Explicit 'confirmed' commitment matters here specifically because this
 * function doubles as the post-close verification read: this connection has
 * no default commitment configured, so an unqualified call defaults to
 * 'finalized' — which lags 'confirmed' (the level close/sweep transactions
 * are confirmed at) by enough that a just-closed account can still show up
 * here as open, and a just-reclaimed rent lamports not yet reflected in a
 * balance read. Read and write need to agree on commitment level or "verify
 * it actually landed" checks a stale, pre-transaction snapshot.
 */
export async function getWalletTokenAccounts(connection: Connection, owner: PublicKey): Promise<HeldTokenAccount[]> {
  const [v1, v2] = await Promise.all([
    connection.getParsedTokenAccountsByOwner(owner, { programId: TOKEN_PROGRAM_ID }, 'confirmed'),
    connection.getParsedTokenAccountsByOwner(owner, { programId: TOKEN_2022_PROGRAM_ID }, 'confirmed'),
  ])

  function toHeldAccounts(items: typeof v1.value, programId: PublicKey): HeldTokenAccount[] {
    return items.map(({ pubkey, account }) => {
      const info = (account.data as unknown as { parsed: { info: { mint: string; tokenAmount: { amount: string; uiAmount: number | null } } } }).parsed.info
      return {
        pubkey,
        mint:      info.mint,
        programId,
        rawAmount: info.tokenAmount.amount,
        uiAmount:  info.tokenAmount.uiAmount ?? 0,
      }
    })
  }

  return [...toHeldAccounts(v1.value, TOKEN_PROGRAM_ID), ...toHeldAccounts(v2.value, TOKEN_2022_PROGRAM_ID)]
}

// Base fee for a simple single-instruction legacy tx — same constant the
// existing SOL consolidate/transfer routes use to drain a sender to exactly 0.
const FEE_BUFFER_LAMPORTS = 5_000
// Several close-account instructions comfortably fit in one legacy tx well
// under the 1232-byte limit; kept conservative rather than computing exact
// serialized size like the Jito bundle packer does — this path isn't
// performance-sensitive (a handful of leftover ATAs per wallet, not hundreds).
const CLOSE_BATCH_SIZE = 15

export interface RetireChainResult {
  closedAccounts:  number
  closeSignatures: string[]
  sweepSignature:  string | null
  sweptLamports:   string
}

/**
 * Closes every given (already-verified-empty) token account, reclaiming its
 * rent into the wallet's own SOL balance, then sweeps everything to
 * `destination`. Caller must have already confirmed every account in
 * `emptyAccounts` truly has a zero balance — this function doesn't re-check.
 *
 * `feePayer`, if given, pays every transaction fee instead of `walletKeypair`
 * — a Solana transaction fee is deducted from the fee payer's balance before
 * any instruction runs, so a wallet already swept to near-zero SOL genuinely
 * cannot submit even its own close-account transaction to reclaim that
 * account's rent, no matter how much the close would hand back afterward.
 * Fee payer and account owner don't have to be the same account; the wallet
 * being retired still signs (required as authority/sender either way), it
 * just isn't the one paying. With a fee payer covering costs, the wallet has
 * nothing of its own to reserve, so the sweep drains its full balance
 * instead of leaving FEE_BUFFER_LAMPORTS behind.
 */
export async function closeEmptyTokenAccountsAndSweep(
  connection:     Connection,
  walletKeypair:  Keypair,
  emptyAccounts:  HeldTokenAccount[],
  destination:    PublicKey,
  feePayer:       Keypair | null = null,
): Promise<RetireChainResult> {
  const closeSignatures: string[] = []
  const signers = feePayer ? [feePayer, walletKeypair] : [walletKeypair]

  for (let i = 0; i < emptyAccounts.length; i += CLOSE_BATCH_SIZE) {
    const batch = emptyAccounts.slice(i, i + CLOSE_BATCH_SIZE)
    const transaction = new Transaction()
    if (feePayer) transaction.feePayer = feePayer.publicKey
    for (const acc of batch) {
      transaction.add(
        createCloseAccountInstruction(acc.pubkey, walletKeypair.publicKey, walletKeypair.publicKey, [], acc.programId),
      )
    }
    const signature = await sendAndConfirmTransaction(connection, transaction, signers, { commitment: 'confirmed' })
    closeSignatures.push(signature)
  }

  // 'confirmed' — see getWalletTokenAccounts's comment; the close batch(es)
  // above just confirmed at that level and this balance needs to reflect
  // the rent they reclaimed, not a pre-close snapshot.
  const balance = await connection.getBalance(walletKeypair.publicKey, 'confirmed')
  const feeReserve = feePayer ? 0 : FEE_BUFFER_LAMPORTS
  let sweepSignature: string | null = null
  let sweptLamports = '0'

  if (balance > feeReserve) {
    const sendAmount = balance - feeReserve
    const transaction = new Transaction()
    if (feePayer) transaction.feePayer = feePayer.publicKey
    transaction.add(
      SystemProgram.transfer({ fromPubkey: walletKeypair.publicKey, toPubkey: destination, lamports: sendAmount }),
    )
    sweepSignature = await sendAndConfirmTransaction(connection, transaction, signers, { commitment: 'confirmed' })
    sweptLamports = sendAmount.toString()
  }

  return {
    closedAccounts: emptyAccounts.length,
    closeSignatures,
    sweepSignature,
    sweptLamports,
  }
}

/** Rough minimum SOL needed to pay for closing this many accounts — one small fee per batch. */
export function minLamportsToCloseAccounts(accountCount: number): number {
  if (accountCount === 0) return 0
  return Math.ceil(accountCount / CLOSE_BATCH_SIZE) * FEE_BUFFER_LAMPORTS
}

/** Same idea as minLamportsToCloseAccounts, plus one more fee for the final sweep transaction. */
export function minLamportsForFeePayer(accountCount: number): number {
  return minLamportsToCloseAccounts(accountCount) + FEE_BUFFER_LAMPORTS
}

export interface RetireOutcome {
  success:         boolean
  error?:          string
  closedAccounts?: number
  sweptLamports?:  string
}

/**
 * The full check-close-sweep-retire sequence for one wallet, shared by both
 * the single-wallet and bulk retire routes so the safety invariant (never
 * flip is_active unless the wallet is verifiably empty afterward) lives in
 * exactly one place. Caller owns the keypair lifecycle indirectly — this
 * function fetches it itself and always wipes it before returning.
 *
 * `feePayerWalletId`, if given, is one of our own vault wallets that covers
 * every transaction fee instead of requiring the wallet-to-be-retired to
 * hold its own SOL for fees — see closeEmptyTokenAccountsAndSweep's comment
 * for why that's a protocol-level requirement, not a check this code chose
 * to impose. Without it, a wallet already swept to near-zero SOL that still
 * has leftover empty token accounts genuinely cannot be retired on its own.
 */
export async function retireWallet(
  connection:       Connection,
  supabase:         Awaited<ReturnType<typeof createClient>>,
  walletId:         string,
  destination:      PublicKey,
  feePayerWalletId?: string,
): Promise<RetireOutcome> {
  let keypair: Keypair | null = null
  let feePayerKeypair: Keypair | null = null
  const log = (msg: string) => console.log(`[wallet-retire] wallet=${walletId} ${msg}`)
  try {
    log('starting')
    // Already refuses an is_active=false wallet — see get_wallet_secret_by_id().
    keypair = await getWalletKeypairById(walletId)

    if (feePayerWalletId) {
      feePayerKeypair = await getWalletKeypairById(feePayerWalletId)
    }

    const tokenAccounts = await getWalletTokenAccounts(connection, keypair.publicKey)
    log(`found ${tokenAccounts.length} token account(s)`)
    const nonZero = tokenAccounts.filter((a) => a.rawAmount !== '0')
    if (nonZero.length > 0) {
      log(`rejected — still holds ${nonZero.length} nonzero token account(s)`)
      return {
        success: false,
        error: `Still holds tokens — transfer or sell first: ${nonZero.map((a) => `${a.uiAmount} of ${a.mint}`).join(', ')}`,
      }
    }

    if (feePayerKeypair) {
      const feePayerBalance = await connection.getBalance(feePayerKeypair.publicKey, 'confirmed')
      const minNeeded = minLamportsForFeePayer(tokenAccounts.length)
      if (feePayerBalance < minNeeded) {
        log(`rejected — fee payer balance ${feePayerBalance} below required ${minNeeded}`)
        return { success: false, error: `Fee payer wallet needs at least ${minNeeded} lamports to cover this retire.` }
      }
    } else {
      const initialBalance = await connection.getBalance(keypair.publicKey, 'confirmed')
      const minNeeded = minLamportsToCloseAccounts(tokenAccounts.length)
      if (initialBalance < minNeeded) {
        log(`rejected — balance ${initialBalance} below required ${minNeeded}`)
        return {
          success: false,
          error: `Needs at least ${minNeeded} lamports to close ${tokenAccounts.length} leftover token account(s) — fund with a small amount of SOL, or pick a fee payer wallet.`,
        }
      }
    }

    log(`closing ${tokenAccounts.length} account(s) and sweeping to ${destination.toBase58()}${feePayerKeypair ? ` (fees paid by ${feePayerWalletId})` : ''}`)
    const result = await closeEmptyTokenAccountsAndSweep(connection, keypair, tokenAccounts, destination, feePayerKeypair)
    log(`close+sweep done — closeSigs=${result.closeSignatures.length} sweepSig=${result.sweepSignature ?? 'none'} swept=${result.sweptLamports}`)

    const [finalBalance, finalTokenAccounts] = await Promise.all([
      connection.getBalance(keypair.publicKey, 'confirmed'),
      getWalletTokenAccounts(connection, keypair.publicKey),
    ])

    if (finalTokenAccounts.length > 0) {
      log(`verify failed — ${finalTokenAccounts.length} account(s) still open`)
      return { success: false, error: `${finalTokenAccounts.length} token account(s) failed to close — not retired`, ...result }
    }
    const finalBalanceCeiling = feePayerKeypair ? 0 : FEE_BUFFER_LAMPORTS
    if (finalBalance > finalBalanceCeiling) {
      log(`verify failed — ${finalBalance} lamports remain`)
      return { success: false, error: `Still holds ${finalBalance} lamports after sweep — not retired`, ...result }
    }

    const { error: retireError } = await supabase.rpc('retire_wallet', { p_wallet_id: walletId })
    if (retireError) {
      log(`swept clean but retire_wallet RPC failed: ${retireError.message}`)
      return { success: false, error: `Swept but couldn't be marked retired: ${retireError.message}`, ...result }
    }

    log('retired successfully')
    return { success: true, ...result }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Retire failed'
    log(`threw: ${message}`)
    return { success: false, error: message }
  } finally {
    keypair?.secretKey.fill(0)
    feePayerKeypair?.secretKey.fill(0)
  }
}

export { FEE_BUFFER_LAMPORTS }
