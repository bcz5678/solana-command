// Message/response shapes for the local relay server. See lib/wss/API.md.

export interface TokenLaunchEvent {
  type: 'token-launch'
  signature: string
  time: string
  name: string | null
  symbol: string | null
  metadataUri: string | null
  mint: string | null
  creator: string | null
  isV2: boolean
  hasGithub: boolean
  githubUrls: string[]
  imageUri: string | null
  description: string | null
  marketCapSol: number | null
  website: string | null
  twitter: string | null
  telegram: string | null
}

export type CoinTxType = 'buy' | 'sell' | 'transfer' | 'unknown'

export interface CoinTransactionEvent {
  type: 'coin-transaction'
  signature: string
  slot: number
  timestamp: number
  mint: string
  wallet: string
  txType: CoinTxType
  tokenAmount: number
  solAmount: number
  priceSol: number | null
  marketCapSol: number | null
}

export interface TokenBalanceChange {
  mint: string
  amount: number
}

export interface WalletTransactionEvent {
  type: 'wallet-transaction'
  signature: string
  slot: number
  timestamp: number
  wallet: string
  isFeePayer: boolean
  solAmount: number
  tokenChanges: TokenBalanceChange[]
}

export interface StatusEvent {
  type: 'status'
  connected: boolean
  uptime: number
  totalLaunches: number
  githubLaunches: number
  clients: number
}

export interface HeartbeatEvent {
  type: 'heartbeat'
  ts: number
}

export type RelayMessage =
  | TokenLaunchEvent
  | CoinTransactionEvent
  | WalletTransactionEvent
  | StatusEvent
  | HeartbeatEvent

export interface WatchedMintsResponse {
  mints: string[]
}

export interface WatchedWalletsResponse {
  wallets: string[]
}

export interface HealthResponse {
  status: string
  solana: boolean
  wallets: boolean
  clients: number
  totalLaunches: number
  totalWalletTxs: number
  uptime: number
}
