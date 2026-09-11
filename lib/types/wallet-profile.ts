// lib/types/wallet-profile.ts

export interface WalletProfile {
  walletId:          string
  publicKey:         string
  label:             string | null
  username:          string | null
  bio:               string | null
  avatarUrl:         string | null
  pumpfunSetup:      boolean
  terminalLinked:    boolean
  profileCreatedAt:  string | null
  profileUpdatedAt:  string | null
}
