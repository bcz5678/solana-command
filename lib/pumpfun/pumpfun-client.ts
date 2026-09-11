// lib/pumpfun/pumpfun-client.ts
//
// Shared wallet-signature auth + proxy/Cloudflare plumbing for talking to
// pump.fun's backend as a specific wallet. Extracted from comment-bot.ts
// (which pioneered and confirmed this flow live) so new pump.fun-writing
// features — first user of this: profile-bot.ts — reuse the exact same
// proven auth/retry/block-detection logic instead of re-deriving it.
//
// Confirmed live 2026-08-31/09-02 (comment-bot.ts's own history):
//   1. Sign `Sign in to pump.fun: {timestamp}` with the wallet's raw ed25519
//      secret key (tweetnacl, not a Solana Transaction).
//   2. POST frontend-api-v3.pump.fun/auth/login with
//      {address, signature, timestamp} -> auth_token cookie.
//   3. Every subsequent write is cookie-authed with that auth_token — NOT a
//      per-request inline {signature, timestamp} field. Reference bots
//      floating around that post signature/timestamp directly in a write's
//      body are targeting an older/renamed API generation; this cookie flow
//      is what's actually confirmed working against pump.fun today.

import { Keypair } from '@solana/web3.js'
import nacl from 'tweetnacl'
import bs58 from 'bs58'
import { fetch as proxyFetch, ProxyAgent, type Dispatcher, type Response as ProxyFetchResponse } from 'undici'
import { getNextProxyUrl } from '@/lib/pumpfun/proxy-pool'

export const PUMPFUN_API = 'https://frontend-api-v3.pump.fun'

export function getProxyDispatcher(): Dispatcher {
  try {
    return new ProxyAgent(getNextProxyUrl())
  } catch (poolErr) {
    // lib/proxies.txt missing/empty in this environment — fall back to the
    // single ProxyCheap gateway rather than hard-failing every request.
    const fallbackUrl = process.env.PUMPFUN_COMMENT_PROXY
    if (!fallbackUrl) {
      throw new Error(
        `No proxy available for pump.fun requests — proxy pool: ${(poolErr as Error).message}; ` +
        `PUMPFUN_COMMENT_PROXY fallback is also not set`
      )
    }
    return new ProxyAgent(fallbackUrl)
  }
}

export function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// Rotating residential proxies occasionally hand out a dead exit node — that
// surfaces as fetch() itself throwing (undici's TypeError "fetch failed"),
// distinct from pump.fun rejecting the request, which callers turn into a
// normal return value instead of a throw. Only the former is worth retrying.
//
// A THIRD case looks like a real rejection but isn't: Cloudflare (sitting in
// front of pump.fun) occasionally edge-blocks a specific exit IP and serves
// an HTML challenge/redirect page instead of ever reaching pump.fun's app —
// confirmed live 2026-09-07. Treated as retryable via CloudflareBlockError
// since a fresh rotated exit is likely to fix it.
export class CloudflareBlockError extends Error {
  constructor(status: number, context: string) {
    super(`pump.fun edge-blocked this proxy exit during ${context}: HTTP ${status} (Cloudflare challenge page, not pump.fun's API)`)
    this.name = 'CloudflareBlockError'
  }
}

export function looksLikeCloudflareBlock(bodyText: string): boolean {
  const t = bodyText.trimStart()
  return t.startsWith('<!DOCTYPE') || t.startsWith('<html')
    || bodyText.includes('static.pump.fun/blocked') || bodyText.includes('challenge-platform')
}

export function isRetryableProxyFailure(err: unknown): boolean {
  return err instanceof CloudflareBlockError
    || (err instanceof TypeError && err.message === 'fetch failed')
}

/** Parses a JSON response body, but throws CloudflareBlockError first if the
 *  body is actually an HTML edge-block page — callers must not silently
 *  treat that as "pump.fun returned no useful JSON" and give up. */
export async function readJsonOrThrowIfBlocked(res: ProxyFetchResponse, context: string): Promise<any> {
  const bodyText = await res.text().catch(() => '')
  if (looksLikeCloudflareBlock(bodyText)) {
    throw new CloudflareBlockError(res.status, context)
  }
  try {
    return bodyText ? JSON.parse(bodyText) : null
  } catch {
    return null
  }
}

const PROXY_MAX_ATTEMPTS = 3

// Retries the whole login-through-action cycle with a FRESH ProxyAgent (new
// exit IP), not just the one failed fetch — keeps login and its paired
// action on the same identity for every attempt, not just the first.
export async function withProxyRetry<T>(fn: (dispatcher: Dispatcher) => Promise<T>): Promise<T> {
  for (let attempt = 1; attempt <= PROXY_MAX_ATTEMPTS; attempt++) {
    try {
      return await fn(getProxyDispatcher())
    } catch (err) {
      if (!isRetryableProxyFailure(err) || attempt === PROXY_MAX_ATTEMPTS) throw err
      const reason = err instanceof CloudflareBlockError ? 'Cloudflare edge-blocked this exit IP' : 'proxy connection failed'
      console.warn(`[pumpfun-client] ${reason} (attempt ${attempt}/${PROXY_MAX_ATTEMPTS}), retrying with a new exit IP:`, (err as Error).message)
      await wait(300 + Math.random() * 500)
    }
  }
  // Unreachable — the loop above always returns or throws.
  throw new Error('withProxyRetry: exhausted attempts')
}

// Static browser-mimicking headers — matches what every reference bot sends
// on this flow. Not a real anti-detection measure by itself.
export const BROWSER_HEADERS: Record<string, string> = {
  'Accept':               '*/*',
  'Content-Type':         'application/json',
  'Origin':                'https://pump.fun',
  'Referer':               'https://pump.fun/',
  'User-Agent':            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
  'sec-ch-ua':             '"Chromium";v="125", "Not.A/Brand";v="24"',
  'sec-ch-ua-mobile':      '?0',
  'sec-ch-ua-platform':    '"Windows"',
}

function signLoginMessage(keypair: Keypair): { timestamp: string; signature: string } {
  const timestamp = Date.now().toString()
  const message   = new TextEncoder().encode(`Sign in to pump.fun: ${timestamp}`)
  const signature = nacl.sign.detached(message, keypair.secretKey)
  return { timestamp, signature: bs58.encode(signature) }
}

// Node's fetch (undici) exposes multi-value Set-Cookie via getSetCookie() —
// headers.get('set-cookie') would comma-join multiple cookies into one
// unparseable string, so prefer getSetCookie() when available.
function extractAuthToken(res: ProxyFetchResponse): string | null {
  const cookies = res.headers.getSetCookie()

  for (const cookie of cookies) {
    const match = cookie.match(/(?:^|;\s*)auth_token=([^;]+)/)
    if (match) return match[1]
  }
  return null
}

export async function loginToPumpFun(keypair: Keypair, dispatcher: Dispatcher): Promise<string> {
  const { timestamp, signature } = signLoginMessage(keypair)

  const res = await proxyFetch(`${PUMPFUN_API}/auth/login`, {
    method:  'POST',
    headers: BROWSER_HEADERS,
    body:    JSON.stringify({
      address:   keypair.publicKey.toBase58(),
      signature,
      timestamp,
    }),
    dispatcher,
  })

  if (!res.ok) {
    const bodyText = await res.text().catch(() => '')
    if (looksLikeCloudflareBlock(bodyText)) {
      console.warn(`[pumpfun-client] login edge-blocked by Cloudflare: ${res.status}`)
      throw new CloudflareBlockError(res.status, 'login')
    }
    console.error(`[pumpfun-client] login failed: ${res.status} ${bodyText}`)
    throw new Error(`pump.fun login failed: ${res.status} ${bodyText}`)
  }

  const authToken = extractAuthToken(res)
  if (!authToken) {
    console.error('[pumpfun-client] login succeeded but response carried no auth_token cookie')
    throw new Error('pump.fun login succeeded but returned no auth_token cookie')
  }
  return authToken
}
