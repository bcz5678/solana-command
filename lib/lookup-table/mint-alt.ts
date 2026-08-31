// lib/lookup-table/mint-alt.ts
//
// Builds the address list for a per-mint Address Lookup Table used to compress
// Jito-bundled pump.fun buy/sell transactions. One ALT per mint covers every
// wallet in a launch, built once (post wallet-funding, pre-launch — everything
// here is derivable offline from the mint + creator + wallet addresses alone,
// no on-chain reads required beyond one Global fetch).
//
// What goes in vs. what can't:
//   - Shared pump.fun accounts (global, bonding curve, creator vault, fee
//     recipients, program/event-authority/token-program constants) — identical
//     across every wallet's instruction for this mint, so ALT compression here
//     benefits every transaction in the bundle for free.
//   - Every target wallet's ATA for this mint — non-signer, writable, fully
//     derivable in advance even though the account doesn't exist on-chain yet.
//   - NOT the wallet public keys themselves — every wallet buying/selling must
//     sign its own transaction, and Solana's v0 message format requires signer
//     accounts to live in the transaction's static account keys; an
//     ALT-resolved account is always treated as non-signer by the runtime, so
//     signer pubkeys can never be compressed this way.

import { PublicKey, SystemProgram } from '@solana/web3.js'
import { getAssociatedTokenAddressSync, TOKEN_2022_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID } from '@solana/spl-token'
import {
    PUMP_PROGRAM_ID,
    BREAKING_FEE_RECIPIENTS,
    type Global,
} from '@nirholas/pump-sdk'

// @nirholas/pump-sdk's published dist/index.d.ts declares `export * from './pda'`
// but dist/ only ships a bundled index.js/.d.ts — no pda.d.ts — so that re-export
// resolves to nothing and GLOBAL_PDA/bondingCurveV2Pda/creatorVaultPda/
// PUMP_EVENT_AUTHORITY_PDA aren't actually importable (a build bug in that
// package, not a naming issue). Re-derived here instead — these are plain
// PDA seeds, confirmed against the SDK's source (node_modules/@nirholas/pump-sdk/src/pda.ts).
function pumpPda(seeds: Buffer[]): PublicKey {
    return PublicKey.findProgramAddressSync(seeds, PUMP_PROGRAM_ID)[0]
}
const GLOBAL_PDA = pumpPda([Buffer.from('global')])
const PUMP_EVENT_AUTHORITY_PDA = pumpPda([Buffer.from('__event_authority')])
function bondingCurveV2Pda(mint: PublicKey): PublicKey {
    return pumpPda([Buffer.from('bonding-curve-v2'), mint.toBuffer()])
}
function creatorVaultPda(creator: PublicKey): PublicKey {
    return pumpPda([Buffer.from('creator-vault'), creator.toBuffer()])
}

/** Solana ALT hard cap. */
export const MAX_ALT_ADDRESSES = 256
/** Max addresses `AddressLookupTableProgram.extendLookupTable` accepts per call — stay under the 1232-byte tx limit. */
export const EXTEND_BATCH_SIZE = 20

/**
 * The shared, mint/creator-scoped accounts that appear identically in every
 * wallet's pump.fun buy/sell instruction for this token. Deterministic and
 * offline except for `global`, which only needs one fetch (fee recipients).
 */
export function sharedMintAltAddresses(mint: PublicKey, creator: PublicKey, global: Global): PublicKey[] {
    return [
        GLOBAL_PDA,
        bondingCurveV2Pda(mint),
        creatorVaultPda(creator),
        PUMP_EVENT_AUTHORITY_PDA,
        PUMP_PROGRAM_ID,
        TOKEN_2022_PROGRAM_ID,
        ASSOCIATED_TOKEN_PROGRAM_ID,
        SystemProgram.programId,
        global.feeRecipient,
        ...global.feeRecipients,
        ...BREAKING_FEE_RECIPIENTS,
    ]
}

/** Every target wallet's ATA for this mint — the one per-wallet thing that CAN be ALT-compressed. */
export function walletAtaAddresses(mint: PublicKey, wallets: PublicKey[]): PublicKey[] {
    return wallets.map((w) => getAssociatedTokenAddressSync(mint, w, true, TOKEN_2022_PROGRAM_ID))
}

/**
 * Full, deduped address list for a mint's ALT: shared accounts + every target
 * wallet's ATA. Deduping matters — e.g. `global.feeRecipient` can legitimately
 * coincide with one of the `BREAKING_FEE_RECIPIENTS`.
 */
export function buildMintAltAddresses(params: {
    mint:    PublicKey
    creator: PublicKey
    global:  Global
    wallets: PublicKey[]
}): PublicKey[] {
    const { mint, creator, global, wallets } = params
    const candidates = [
        ...sharedMintAltAddresses(mint, creator, global),
        ...walletAtaAddresses(mint, wallets),
    ]

    const seen = new Set<string>()
    const deduped: PublicKey[] = []
    for (const addr of candidates) {
        const b58 = addr.toBase58()
        if (seen.has(b58)) continue
        seen.add(b58)
        deduped.push(addr)
    }
    return deduped
}

/** Splits an address list into `extendLookupTable`-sized chunks. */
export function chunkForExtend(addresses: PublicKey[]): PublicKey[][] {
    const chunks: PublicKey[][] = []
    for (let i = 0; i < addresses.length; i += EXTEND_BATCH_SIZE) {
        chunks.push(addresses.slice(i, i + EXTEND_BATCH_SIZE))
    }
    return chunks
}
