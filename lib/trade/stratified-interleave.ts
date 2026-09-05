// lib/trade/stratified-interleave.ts
//
// Orders a set of wallets for a staggered run so trade size doesn't
// correlate with position in the sequence. Neither a strict large-first nor
// small-first ramp is safe — both are recognizable shapes to sniper/
// copy-trade bots that specifically watch for a ramping-size pattern across
// a mint's recent buys, and a large-first order additionally risks getting
// front-run on the very trade that sets the tone for everything after it.
// A single full shuffle (Math.random() sort) already randomizes order, but
// leaves it to chance whether large wallets cluster together — this
// guarantees they're spread roughly evenly across the whole run instead.
//
// Buckets wallets into size tiers (by whatever amount getter the caller
// provides), shuffles each tier's own membership, then interleaves the
// tiers round-robin — re-shuffling which tier goes first each round, so the
// result isn't a rigid large-medium-small-large-medium-small rhythm either.

export function stratifiedInterleave(
  walletIds: string[],
  amountOf:  (id: string) => number,
  tierCount = 3,
): string[] {
  // Too few wallets for tiering to mean anything — plain shuffle.
  if (walletIds.length <= tierCount) {
    return [...walletIds].sort(() => Math.random() - 0.5)
  }

  const sorted = [...walletIds].sort((a, b) => amountOf(b) - amountOf(a))

  const chunkSize = Math.ceil(sorted.length / tierCount)
  const tiers: string[][] = []
  for (let i = 0; i < sorted.length; i += chunkSize) {
    tiers.push(sorted.slice(i, i + chunkSize))
  }
  tiers.forEach((tier) => tier.sort(() => Math.random() - 0.5))

  const result: string[] = []
  const maxTierLen = Math.max(...tiers.map((t) => t.length))
  for (let round = 0; round < maxTierLen; round++) {
    const tierOrder = tiers.map((_, i) => i).sort(() => Math.random() - 0.5)
    for (const t of tierOrder) {
      const id = tiers[t][round]
      if (id) result.push(id)
    }
  }
  return result
}
