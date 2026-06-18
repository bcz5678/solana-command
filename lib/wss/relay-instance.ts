import { RelayClient } from './client'

declare global {
  // eslint-disable-next-line no-var
  var __relayClient: RelayClient | undefined
}

// Shared connection for the whole server process — cached on globalThis so
// Next.js dev HMR reuses it instead of opening a new socket on every reload.
export const relay = globalThis.__relayClient ?? new RelayClient()

if (process.env.NODE_ENV !== 'production') {
  globalThis.__relayClient = relay
}
