// lib/jito/pack-wallets.ts
//
// Greedily packs per-wallet instruction sets into as few transactions as
// possible for a Jito bundle, bounded by the REAL serialized transaction
// size (which ALT compression shrinks dramatically) instead of a hardcoded
// wallets-per-tx constant. Previously bundle/buy and bundle/sell hardcoded
// WALLETS_PER_BATCH = 2 to stay safely under the 1232-byte limit with no
// ALT — with a mint's dedicated ALT in play (see lib/lookup-table/mint-alt.ts)
// that same limit fits several times as many wallets.

import { PublicKey, TransactionInstruction, TransactionMessage, VersionedTransaction, AddressLookupTableAccount } from '@solana/web3.js'

const SOLANA_TX_SIZE_LIMIT = 1232
// Conservative reserve for the Jito tip transfer appended to whichever batch
// ends up last — which batch that'll be isn't known until packing finishes,
// so every candidate batch is checked as if it might be the last one.
const TIP_INSTRUCTION_MARGIN = 100

export interface WalletIxSet {
    wallet: { publicKey: PublicKey }
    ixs:    TransactionInstruction[]
}

function fitsWithinLimit(batch: WalletIxSet[], blockhash: string, lookupTables: AddressLookupTableAccount[]): boolean {
    if (batch.length === 0) return true
    try {
        const message = new TransactionMessage({
            payerKey:        batch[0].wallet.publicKey,
            recentBlockhash: blockhash,
            instructions:    batch.flatMap((b) => b.ixs),
        }).compileToV0Message(lookupTables)

        const tx = new VersionedTransaction(message)
        return tx.serialize().length + TIP_INSTRUCTION_MARGIN <= SOLANA_TX_SIZE_LIMIT
    } catch {
        // compileToV0Message throws if the account/instruction count itself is
        // unworkable (e.g. too many accounts for a v0 message) — treat as "doesn't fit".
        return false
    }
}

/**
 * Packs `items` into batches, adding one at a time and closing out the
 * current batch (starting a new one) the moment the next item would push the
 * serialized size over the limit. A single item that doesn't fit even alone
 * is still emitted as its own batch — silently dropping a wallet would be
 * worse than letting simulation surface the real "too big" error.
 */
export function packWalletsBySize<T extends WalletIxSet>(
    items:        T[],
    blockhash:    string,
    lookupTables: AddressLookupTableAccount[],
): T[][] {
    const batches: T[][] = []
    let current: T[] = []

    for (const item of items) {
        const candidate = [...current, item]
        if (fitsWithinLimit(candidate, blockhash, lookupTables)) {
            current = candidate
            continue
        }
        if (current.length === 0) {
            // Doesn't fit even alone — emit as-is rather than drop it.
            batches.push([item])
            continue
        }
        batches.push(current)
        current = [item]
    }
    if (current.length > 0) batches.push(current)

    return batches
}
