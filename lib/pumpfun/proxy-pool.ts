// lib/pumpfun/proxy-pool.ts
//
// Rotating pool of IPRoyal sticky-session proxies, replacing the single
// ProxyCheap gateway in PUMPFUN_COMMENT_PROXY — confirmed live 2026-09-08:
// ProxyCheap's rotating gateway was hitting Cloudflare's interstitial on
// pump.fun roughly half the time (3/6 clean in a corrected test — the first
// pass over-counted blocks by matching on `<!DOCTYPE`/`challenge-platform`,
// which also appear on pump.fun's own normal homepage and its legitimate
// Cloudflare Turnstile widget respectively; the real signal is the
// interstitial's own redirect target, `url=https://static.pump.fun/blocked`).
// The same test against a 20-session IPRoyal sample came back 19/20 clean.
//
// lib/proxies.txt (gitignored — real credentials) is one `host:port:user:pass`
// per line. Each line is an IPRoyal STICKY session (the password suffix
// encodes `session-<id>_lifetime-168h`) — reusing a line's exact host/port/
// user/pass keeps landing on the same exit IP for up to 7 days, but nothing
// here holds a line open that long: this rotates to the NEXT line on every
// call, matching the "one exit IP per wallet action" boundary comment-bot.ts
// already used for the single-proxy setup (see its own header comment) —
// each wallet's login+post+reply cycle gets one pool entry, and the next
// wallet action gets the next one, round-robin, wrapping at the end of the
// file. A line's own 7-day stickiness just means it'll present the same IP
// again if the pool wraps around within that window, which is fine — it
// isn't being reused WITHIN one wallet's own action, which is what actually
// matters for not correlating unrelated wallets to the same exit IP.

import { readFileSync } from 'fs'
import { join } from 'path'

const POOL_FILE = join(process.cwd(), 'lib', 'proxies.txt')

let cachedLines: string[] | null = null
let cursor = 0

function loadLines(): string[] {
  if (cachedLines) return cachedLines
  const raw = readFileSync(POOL_FILE, 'utf8')
  cachedLines = raw
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'))
  if (cachedLines.length === 0) {
    throw new Error(`lib/proxies.txt has no usable proxy lines`)
  }
  return cachedLines
}

function lineToProxyUrl(line: string): string {
  const parts = line.split(':')
  if (parts.length !== 4) {
    throw new Error(`lib/proxies.txt: malformed line (expected host:port:user:pass): ${line.slice(0, 20)}…`)
  }
  const [host, port, user, pass] = parts
  return `http://${encodeURIComponent(user)}:${encodeURIComponent(pass)}@${host}:${port}`
}

/** Next pool entry, round-robin. Each call advances the cursor — callers
 *  needing one identity for a multi-request action (login + post, say)
 *  must call this ONCE and reuse the resulting dispatcher for all of it. */
export function getNextProxyUrl(): string {
  const lines = loadLines()
  const line = lines[cursor % lines.length]
  cursor++
  return lineToProxyUrl(line)
}

/** Pool size, for diagnostics/logging. */
export function proxyPoolSize(): number {
  return loadLines().length
}
