// lib/wallet/token-transfer.ts
//
// Wallet-to-wallet SPL token transfers — raw transfer + create-if-missing ATA,
// distinct from every existing token-moving code path in this repo, which
// only ever moves tokens between a wallet and pump.fun's bonding curve/AMM
// (@nirholas/pump-sdk buy/sell instructions). No bonding-curve pricing here,
// just a plain owner-to-owner instruction pair.
//
// Single-transfer-per-transaction, submitted via QuickNode's smart-transaction
// path, same convention as the existing SOL transfer routes in
// app/api/wallet/transfer/{single,fund}. No Jito bundling — unlike trades,
// a transfer has no front-running risk to defend against, so there's nothing
// bundling would buy here that plain sequential submission doesn't already
// give for free.

import { Connection, Keypair, PublicKey, Transaction } from '@solana/web3.js'
import {
  createAssociatedTokenAccountIdempotentInstruction,
  createTransferCheckedInstruction,
  getAssociatedTokenAddressSync,
  getMint,
} from '@solana/spl-token'
import type { Solana } from '@quicknode/sdk'
import { resolveTokenProgram } from '@/lib/trade/wallet-balance'

export interface MintInfo {
  programId: PublicKey
  decimals:  number
}

/** Resolves which token program a mint belongs to and its decimals, in one round trip. */
export async function resolveMintInfo(connection: Connection, mint: PublicKey): Promise<MintInfo> {
  const programId = await resolveTokenProgram(connection, mint)
  const mintAccount = await getMint(connection, mint, undefined, programId)
  return { programId, decimals: mintAccount.decimals }
}

/**
 * UI decimal amount -> raw base-unit amount. Mirrors the existing SOL routes'
 * `Math.round(amountSOL * 1_000_000_000)` convention (float multiply, round,
 * same tolerance this codebase already accepts for lamports) rather than
 * pulling in exact-decimal parsing for a codebase-wide-consistent tradeoff.
 */
export function uiAmountToRaw(amount: number, decimals: number): bigint {
  return BigInt(Math.round(amount * 10 ** decimals))
}

/**
 * Builds the sender -> receiver SPL transfer instruction pair: create the
 * receiver's ATA if it doesn't exist yet (sender pays the rent, idempotent —
 * a no-op if it's already there, so no separate existence check is needed),
 * then transferChecked (validates mint + decimals match, unlike a plain
 * transfer instruction).
 */
export function buildTokenTransferInstructions(
  mint:      PublicKey,
  sender:    PublicKey,
  receiver:  PublicKey,
  amountRaw: bigint,
  mintInfo:  MintInfo,
) {
  const senderAta   = getAssociatedTokenAddressSync(mint, sender, true, mintInfo.programId)
  const receiverAta = getAssociatedTokenAddressSync(mint, receiver, true, mintInfo.programId)
  return [
    createAssociatedTokenAccountIdempotentInstruction(sender, receiverAta, receiver, mint, mintInfo.programId),
    createTransferCheckedInstruction(senderAta, mint, receiverAta, sender, amountRaw, mintInfo.decimals, [], mintInfo.programId),
  ]
}

export async function sendTokenTransfer(
  solana:        Solana,
  senderKeypair: Keypair,
  mint:          PublicKey,
  receiver:      PublicKey,
  amountRaw:     bigint,
  mintInfo:      MintInfo,
): Promise<string> {
  const transaction = new Transaction()
  transaction.add(...buildTokenTransferInstructions(mint, senderKeypair.publicKey, receiver, amountRaw, mintInfo))

  return solana.sendSmartTransaction({
    transaction,
    keyPair:  senderKeypair,
    feeLevel: 'recommended',
  })
}
