export interface ClaimVanityResponse {
  keypairId:  string    // UUID — passed to Phase 2
  publicKey:  string    // base58 — use for image + metadata naming
}