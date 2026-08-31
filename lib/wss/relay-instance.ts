import { RelayClient } from './client'

declare global {
  // eslint-disable-next-line no-var
  var __relayClient: RelayClient | undefined
}

// Shared connection for the whole server process — cached on globalThis so
// Next.js dev HMR reuses it instead of opening a new socket on every reload.
// RELAY_BASE_URL lets this point at a non-colocated websocket-server deployment
// (e.g. Railway) instead of the localhost default — unset in local dev, where
// both apps run on the same host.
export const relay = globalThis.__relayClient ?? new RelayClient({ baseUrl: process.env.RELAY_BASE_URL })

if (process.env.NODE_ENV !== 'production') {
  globalThis.__relayClient = relay
}
