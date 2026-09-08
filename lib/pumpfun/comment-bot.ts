// lib/pumpfun/comment-bot.ts
//
// Phase 1: auth + posting core for the pump.fun comment bot. No proxy
// rotation yet. CAPTCHA handling was deferred pending a live check — that
// check is done: a probe against a throwaway wallet + non-existent mint
// reached real business logic (400 PRICE_UNAVAILABLE, i.e. the token-price
// lookup) with nothing but wallet-signature auth, no Turnstile/hCaptcha
// challenge anywhere in the response. CAPTCHA does not appear to gate this
// endpoint today, so Phase 3 (a solver) is on hold unless live testing
// against a real mint says otherwise.
//
// Endpoint shapes below were reverse-engineered from pump.fun's live
// Next.js bundle (2026-08-31) — every published reference bot for this
// flow (thread-token + client-proxy-server.pump.fun/comment) targets a
// dead/renamed API generation and 404s or DNS-fails today:
//   1. Sign `Sign in to pump.fun: {timestamp}` with the wallet's raw
//      ed25519 secret key (tweetnacl, not a Solana Transaction).
//   2. POST frontend-api-v3.pump.fun/auth/login with
//      {address, signature, timestamp} -> auth_token cookie (confirmed live).
//   3. POST frontend-api-v3.pump.fun/callout/create, cookie-authed, with
//      {coinMint, thesis, version: 2} -> {callout: {calloutId}}.
//      pump.fun renamed "comments" to "Callouts" at some point after the
//      reference bots were written — "thesis" is the comment text field.
//   4. Follow-up replies threaded under a callout (yours or someone else's)
//      are a separate endpoint, confirmed live 2026-09-02:
//      POST frontend-api-v3.pump.fun/callout/{calloutId}/replies, cookie-authed,
//      body {content} -> {replyId, createdAt, mediaUrl, rootMessageId}. Distinct
//      $1-hold gate from the parent callout's own eligibility (GET
//      /callout/eligibility/{mint} returns reply.authorVerdict vs
//      reply.nonAuthorVerdict — replying to your own callout stays eligible
//      even after your position has closed, unlike posting a new one).
//
// Every request to pump.fun (login + the actual post) is routed through a
// proxy, so different wallets' callouts don't all originate from this
// server's own IP. Required, not best-effort: no proxy available fails the
// call rather than silently posting direct. login and its paired post/reply/
// lookup share ONE dispatcher (one exit IP) per wallet action — the auth
// cookie is tied to the login's apparent identity, so switching IPs mid-flow
// would look more suspicious, not less. Separate top-level calls (different
// wallets, or the same wallet again later) each get the NEXT pool entry,
// which is what actually rotates the IP.
//
// Primary source is lib/proxies.txt (gitignored, real credentials) via
// lib/pumpfun/proxy-pool.ts — a rotating pool of IPRoyal sticky sessions,
// swapped in 2026-09-08 after ProxyCheap's single rotating gateway
// (PUMPFUN_COMMENT_PROXY, still supported as a fallback if the pool file
// isn't provisioned in a given environment) was confirmed hitting Cloudflare's
// interstitial on pump.fun roughly half the time in a live test, vs. 19/20
// clean for IPRoyal in the same test.

import { Keypair } from '@solana/web3.js'
import nacl from 'tweetnacl'
import bs58 from 'bs58'
import { fetch as proxyFetch, ProxyAgent, type Dispatcher, type Response as ProxyFetchResponse } from 'undici'
import { getWalletKeypairById } from '@/lib/vault/get-wallet-by-id'
import { getNextProxyUrl } from '@/lib/pumpfun/proxy-pool'

const PUMPFUN_API = 'https://frontend-api-v3.pump.fun'

function getProxyDispatcher(): Dispatcher {
  try {
    return new ProxyAgent(getNextProxyUrl())
  } catch (poolErr) {
    // lib/proxies.txt missing/empty in this environment — fall back to the
    // single ProxyCheap gateway rather than hard-failing every comment.
    const fallbackUrl = process.env.PUMPFUN_COMMENT_PROXY
    if (!fallbackUrl) {
      throw new Error(
        `No proxy available for pump.fun comments — proxy pool: ${(poolErr as Error).message}; ` +
        `PUMPFUN_COMMENT_PROXY fallback is also not set`
      )
    }
    return new ProxyAgent(fallbackUrl)
  }
}

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// Rotating residential proxies occasionally hand out a dead exit node — that
// surfaces as fetch() itself throwing (undici's TypeError "fetch failed"),
// distinct from pump.fun rejecting the request (login failure, EXISTING_
// CALLOUT, INSUFFICIENT_BALANCE, ...), which the callers below turn into a
// normal return value instead of a throw. Only the former is worth retrying —
// retrying a real rejection would just burn attempts on something a new IP
// can't fix.
//
// A THIRD case looks like a real rejection but isn't: Cloudflare (sitting in
// front of pump.fun) occasionally edge-blocks a specific exit IP and serves
// an HTML challenge/redirect page (to static.pump.fun/blocked) instead of
// ever reaching pump.fun's app — confirmed live 2026-09-07, a 403 with that
// exact HTML body while other wallets on the same proxy gateway succeeded
// minutes earlier. That's an IP-reputation problem a fresh rotated exit is
// likely to fix, so it's treated as retryable via CloudflareBlockError below
// instead of the generic non-ok-response path.
class CloudflareBlockError extends Error {
  constructor(status: number, context: string) {
    super(`pump.fun edge-blocked this proxy exit during ${context}: HTTP ${status} (Cloudflare challenge page, not pump.fun's API)`)
    this.name = 'CloudflareBlockError'
  }
}

function looksLikeCloudflareBlock(bodyText: string): boolean {
  const t = bodyText.trimStart()
  return t.startsWith('<!DOCTYPE') || t.startsWith('<html')
    || bodyText.includes('static.pump.fun/blocked') || bodyText.includes('challenge-platform')
}

function isRetryableProxyFailure(err: unknown): boolean {
  return err instanceof CloudflareBlockError
    || (err instanceof TypeError && err.message === 'fetch failed')
}

/** Parses a JSON response body, but throws CloudflareBlockError first if the
 *  body is actually an HTML edge-block page — callers must not silently
 *  treat that as "pump.fun returned no useful JSON" and give up. */
async function readJsonOrThrowIfBlocked(res: ProxyFetchResponse, context: string): Promise<any> {
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
async function withProxyRetry<T>(fn: (dispatcher: Dispatcher) => Promise<T>): Promise<T> {
  for (let attempt = 1; attempt <= PROXY_MAX_ATTEMPTS; attempt++) {
    try {
      return await fn(getProxyDispatcher())
    } catch (err) {
      if (!isRetryableProxyFailure(err) || attempt === PROXY_MAX_ATTEMPTS) throw err
      const reason = err instanceof CloudflareBlockError ? 'Cloudflare edge-blocked this exit IP' : 'proxy connection failed'
      console.warn(`[comment-bot] ${reason} (attempt ${attempt}/${PROXY_MAX_ATTEMPTS}), retrying with a new exit IP:`, (err as Error).message)
      await wait(300 + Math.random() * 500)
    }
  }
  // Unreachable — the loop above always returns or throws.
  throw new Error('withProxyRetry: exhausted attempts')
}

// Static browser-mimicking headers — matches what every reference bot sends
// on this flow. Not a real anti-detection measure by itself (see Phase 4).
const BROWSER_HEADERS: Record<string, string> = {
  'Accept':               '*/*',
  'Content-Type':         'application/json',
  'Origin':                'https://pump.fun',
  'Referer':               'https://pump.fun/',
  'User-Agent':            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
  'sec-ch-ua':             '"Chromium";v="125", "Not.A/Brand";v="24"',
  'sec-ch-ua-mobile':      '?0',
  'sec-ch-ua-platform':    '"Windows"',
}

export interface PostCommentResult {
  success: boolean
  status?: number
  error?:  string
  raw?:    unknown
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

async function loginToPumpFun(keypair: Keypair, dispatcher: Dispatcher): Promise<string> {
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
      console.warn(`[comment-bot] login edge-blocked by Cloudflare: ${res.status}`)
      throw new CloudflareBlockError(res.status, 'login')
    }
    console.error(`[comment-bot] login failed: ${res.status} ${bodyText}`)
    throw new Error(`pump.fun login failed: ${res.status} ${bodyText}`)
  }

  const authToken = extractAuthToken(res)
  if (!authToken) {
    console.error('[comment-bot] login succeeded but response carried no auth_token cookie')
    throw new Error('pump.fun login succeeded but returned no auth_token cookie')
  }
  return authToken
}

async function createCallout(authToken: string, mint: string, text: string, dispatcher: Dispatcher): Promise<PostCommentResult> {
  const res = await proxyFetch(`${PUMPFUN_API}/callout/create`, {
    method:  'POST',
    headers: { ...BROWSER_HEADERS, Cookie: `auth_token=${authToken}` },
    body:    JSON.stringify({ coinMint: mint, thesis: text, version: 2 }),
    dispatcher,
  })

  const raw = await readJsonOrThrowIfBlocked(res, 'callout/create') as { callout?: { calloutId?: string }; message?: string } | null

  if (!res.ok) {
    const error = `callout/create failed: ${res.status} ${raw?.message ?? ''}`.trim()
    console.error(`[comment-bot] ${error}`, raw)
    return { success: false, status: res.status, error, raw }
  }
  if (!raw?.callout?.calloutId) {
    console.error('[comment-bot] callout/create returned 200 but no calloutId', raw)
    return { success: false, status: res.status, error: 'callout/create returned no calloutId', raw }
  }
  console.log(`[comment-bot] callout created mint=${mint} calloutId=${raw.callout.calloutId}`, raw)
  return { success: true, status: res.status, raw }
}

async function createCalloutReply(authToken: string, calloutId: string, text: string, dispatcher: Dispatcher): Promise<PostCommentResult> {
  const res = await proxyFetch(`${PUMPFUN_API}/callout/${calloutId}/replies`, {
    method:  'POST',
    headers: { ...BROWSER_HEADERS, Cookie: `auth_token=${authToken}` },
    body:    JSON.stringify({ content: text }),
    dispatcher,
  })

  const raw = await readJsonOrThrowIfBlocked(res, 'callout/replies') as { replyId?: string; message?: string } | null

  if (!res.ok) {
    const error = `callout/${calloutId}/replies failed: ${res.status} ${raw?.message ?? ''}`.trim()
    console.error(`[comment-bot] ${error}`, raw)
    return { success: false, status: res.status, error, raw }
  }
  if (!raw?.replyId) {
    console.error('[comment-bot] callout/replies returned 200 but no replyId', raw)
    return { success: false, status: res.status, error: 'callout/replies returned no replyId', raw }
  }
  console.log(`[comment-bot] reply posted calloutId=${calloutId} replyId=${raw.replyId}`, raw)
  return { success: true, status: res.status, raw }
}

export interface OwnCalloutLookupResult {
  calloutId: string | null
  thesis?:   string
  error?:    string
}

// GET /callout/eligibility/{mint} carries reason.existingCallout.calloutId
// whenever the wallet has already called out this mint (verdict
// EXISTING_CALLOUT) — the only place a calloutId can be recovered without the
// caller already knowing it, since we don't persist calloutId ourselves.
async function fetchOwnCalloutId(authToken: string, mint: string, dispatcher: Dispatcher): Promise<OwnCalloutLookupResult> {
  const res = await proxyFetch(`${PUMPFUN_API}/callout/eligibility/${mint}`, {
    headers: { ...BROWSER_HEADERS, Cookie: `auth_token=${authToken}` },
    dispatcher,
  })
  const raw = await readJsonOrThrowIfBlocked(res, 'callout/eligibility') as {
    reason?: { type?: string; existingCallout?: { calloutId?: string; thesis?: string } }
  } | null

  if (!res.ok) {
    return { calloutId: null, error: `eligibility check failed: ${res.status}` }
  }
  const existing = raw?.reason?.existingCallout
  if (existing?.calloutId) {
    return { calloutId: existing.calloutId, thesis: existing.thesis }
  }
  return { calloutId: null }
}

/**
 * Full login -> post cycle for one wallet/comment ("callout" in pump.fun's
 * current terminology — see file header for why this isn't the older
 * thread-token flow every reference bot implements).
 * Caller owns the keypair's lifecycle (wipe secretKey after use) — this
 * function only reads from it, matching getWalletKeypairById()'s contract.
 */
export async function postCommentAsWallet(keypair: Keypair, mint: string, text: string): Promise<PostCommentResult> {
  return withProxyRetry(async (dispatcher) => {
    const authToken = await loginToPumpFun(keypair, dispatcher)
    return createCallout(authToken, mint, text, dispatcher)
  })
}

/** Same as postCommentAsWallet, but posts a threaded reply under an existing callout. */
export async function postCalloutReplyAsWallet(keypair: Keypair, calloutId: string, text: string): Promise<PostCommentResult> {
  return withProxyRetry(async (dispatcher) => {
    const authToken = await loginToPumpFun(keypair, dispatcher)
    return createCalloutReply(authToken, calloutId, text, dispatcher)
  })
}

/** Resolves this wallet's own existing calloutId for a mint, if it has one. */
export async function lookupOwnCalloutIdAsWallet(keypair: Keypair, mint: string): Promise<OwnCalloutLookupResult> {
  return withProxyRetry(async (dispatcher) => {
    const authToken = await loginToPumpFun(keypair, dispatcher)
    return fetchOwnCalloutId(authToken, mint, dispatcher)
  })
}

/**
 * Same as postCommentAsWallet, but resolves the keypair from Vault by
 * wallet UUID and wipes it afterward — the entry point API routes should use.
 */
export async function postPumpFunCommentForWallet(
  walletId: string,
  mint:     string,
  text:     string,
): Promise<PostCommentResult> {
  const keypair = await getWalletKeypairById(walletId)
  try {
    return await postCommentAsWallet(keypair, mint, text)
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err)
    console.error(`[comment-bot] postPumpFunCommentForWallet failed wallet=${walletId} mint=${mint}:`, error)
    return { success: false, error }
  } finally {
    keypair.secretKey.fill(0)
  }
}

/**
 * Same as postPumpFunCommentForWallet, but posts a threaded reply under an
 * existing callout (calloutId) instead of creating a new one — the entry
 * point API routes should use for follow-up comments.
 */
export async function postPumpFunCalloutReplyForWallet(
  walletId:  string,
  calloutId: string,
  text:      string,
): Promise<PostCommentResult> {
  const keypair = await getWalletKeypairById(walletId)
  try {
    return await postCalloutReplyAsWallet(keypair, calloutId, text)
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err)
    console.error(`[comment-bot] postPumpFunCalloutReplyForWallet failed wallet=${walletId} calloutId=${calloutId}:`, error)
    return { success: false, error }
  } finally {
    keypair.secretKey.fill(0)
  }
}

/**
 * Same as postPumpFunCalloutReplyForWallet, but resolves the wallet's own
 * existing calloutId for a mint instead of posting — the entry point API
 * routes should use to find "my callout" without the caller needing the
 * raw pump.fun UUID.
 */
export async function lookupOwnCalloutIdForWallet(walletId: string, mint: string): Promise<OwnCalloutLookupResult> {
  const keypair = await getWalletKeypairById(walletId)
  try {
    return await lookupOwnCalloutIdAsWallet(keypair, mint)
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err)
    console.error(`[comment-bot] lookupOwnCalloutIdForWallet failed wallet=${walletId} mint=${mint}:`, error)
    return { calloutId: null, error }
  } finally {
    keypair.secretKey.fill(0)
  }
}
