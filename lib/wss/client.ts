import WebSocket from 'ws'
import type {
  RelayMessage,
  WatchedMintsResponse,
  WatchedWalletsResponse,
  HealthResponse,
} from './types'

type HandlerMap = { [K in RelayMessage['type']]?: Array<(msg: Extract<RelayMessage, { type: K }>) => void> }

export interface RelayClientOptions {
  /** Base REST URL of the relay server. @default 'http://localhost:3099' */
  baseUrl?: string
  /** Delay before reconnecting after the socket closes, ms. @default 2000 */
  reconnectDelayMs?: number
  /** Connect immediately on construction. @default true */
  autoConnect?: boolean
}

/**
 * Client for the local token/wallet relay server.
 * See lib/wss/API.md for the full protocol this wraps.
 */
export class RelayClient {
  private readonly baseUrl: string
  private readonly wsUrl: string
  private readonly reconnectDelayMs: number
  private ws: WebSocket | null = null
  private closed = false
  private readonly handlers: HandlerMap = {}

  constructor(options: RelayClientOptions = {}) {
    this.baseUrl = options.baseUrl ?? 'http://localhost:3099'
    this.wsUrl = this.baseUrl.replace(/^http/, 'ws') + '/ws'
    this.reconnectDelayMs = options.reconnectDelayMs ?? 2000
    if (options.autoConnect ?? true) this.connect()
  }

  /** Register a handler for one message type. Returns this for chaining. */
  on<T extends RelayMessage['type']>(type: T, handler: (msg: Extract<RelayMessage, { type: T }>) => void): this {
    const list = (this.handlers[type] ??= []) as Array<(msg: Extract<RelayMessage, { type: T }>) => void>
    list.push(handler)
    return this
  }

  /** Remove a previously registered handler. */
  off<T extends RelayMessage['type']>(type: T, handler: (msg: Extract<RelayMessage, { type: T }>) => void): this {
    const list = this.handlers[type]
    if (!list) return this
    const idx = list.indexOf(handler as (msg: RelayMessage) => void)
    if (idx !== -1) list.splice(idx, 1)
    return this
  }

  /** Connect (or reconnect) the WebSocket feed. No-op if already open/connecting. */
  connect(): void {
    if (this.ws && this.ws.readyState !== WebSocket.CLOSED) return
    this.closed = false

    const ws = new WebSocket(this.wsUrl)
    this.ws = ws

    ws.on('message', (raw) => {
      let msg: RelayMessage
      try {
        msg = JSON.parse(raw.toString())
      } catch {
        return
      }
      const list = this.handlers[msg.type]
      list?.forEach((fn) => fn(msg as never))
    })

    ws.on('close', () => {
      if (!this.closed) setTimeout(() => this.connect(), this.reconnectDelayMs)
    })

    ws.on('error', () => ws.close())
  }

  /** Close the socket and stop reconnecting. */
  close(): void {
    this.closed = true
    this.ws?.close()
  }

  private async post<T>(path: string, body: unknown): Promise<T> {
    const res = await fetch(this.baseUrl + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    const json = await res.json()
    if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`)
    return json as T
  }

  private async get<T>(path: string): Promise<T> {
    const res = await fetch(this.baseUrl + path)
    const json = await res.json()
    if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`)
    return json as T
  }

  // ─── Tokens (§3) ──────────────────────────────────────────────

  getWatchedMints(): Promise<WatchedMintsResponse> {
    return this.get('/tokens/watched')
  }

  /** Resolves once the RPC node confirms the subscription is live. */
  watchMint(mint: string): Promise<WatchedMintsResponse> {
    return this.post('/tokens/watch', { mint })
  }

  unwatchMint(mint: string): Promise<WatchedMintsResponse> {
    return this.post('/tokens/unwatch', { mint })
  }

  // ─── Wallets (§4) ─────────────────────────────────────────────

  getWatchedWallets(): Promise<WatchedWalletsResponse> {
    return this.get('/wallets/watched')
  }

  /** Resolves once the RPC node confirms the subscription is live. */
  watchWallet(wallet: string): Promise<WatchedWalletsResponse> {
    return this.post('/wallets/watch', { wallet })
  }

  unwatchWallet(wallet: string): Promise<WatchedWalletsResponse> {
    return this.post('/wallets/unwatch', { wallet })
  }

  // ─── Health (§5) ──────────────────────────────────────────────

  getHealth(): Promise<HealthResponse> {
    return this.get('/health')
  }
}
