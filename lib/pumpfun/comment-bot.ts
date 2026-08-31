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

import { Keypair } from '@solana/web3.js'
import nacl from 'tweetnacl'
import bs58 from 'bs58'
import { getWalletKeypairById } from '@/lib/vault/get-wallet-by-id'

const PUMPFUN_API = 'https://frontend-api-v3.pump.fun'

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
function extractAuthToken(res: Response): string | null {
  const getSetCookie = (res.headers as Headers & { getSetCookie?: () => string[] }).getSetCookie
  const cookies = typeof getSetCookie === 'function'
    ? getSetCookie.call(res.headers)
    : [res.headers.get('set-cookie') ?? '']

  for (const cookie of cookies) {
    const match = cookie.match(/(?:^|;\s*)auth_token=([^;]+)/)
    if (match) return match[1]
  }
  return null
}

async function loginToPumpFun(keypair: Keypair): Promise<string> {
  const { timestamp, signature } = signLoginMessage(keypair)

  const res = await fetch(`${PUMPFUN_API}/auth/login`, {
    method:  'POST',
    headers: BROWSER_HEADERS,
    body:    JSON.stringify({
      address:   keypair.publicKey.toBase58(),
      signature,
      timestamp,
    }),
  })

  if (!res.ok) {
    const bodyText = await res.text().catch(() => '')
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

async function createCallout(authToken: string, mint: string, text: string): Promise<PostCommentResult> {
  const res = await fetch(`${PUMPFUN_API}/callout/create`, {
    method:  'POST',
    headers: { ...BROWSER_HEADERS, Cookie: `auth_token=${authToken}` },
    body:    JSON.stringify({ coinMint: mint, thesis: text, version: 2 }),
  })

  const raw = await res.json().catch(() => null) as { callout?: { calloutId?: string }; message?: string } | null

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

/**
 * Full login -> post cycle for one wallet/comment ("callout" in pump.fun's
 * current terminology — see file header for why this isn't the older
 * thread-token flow every reference bot implements).
 * Caller owns the keypair's lifecycle (wipe secretKey after use) — this
 * function only reads from it, matching getWalletKeypairById()'s contract.
 */
export async function postCommentAsWallet(keypair: Keypair, mint: string, text: string): Promise<PostCommentResult> {
  const authToken = await loginToPumpFun(keypair)
  return createCallout(authToken, mint, text)
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
