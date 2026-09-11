// lib/pumpfun/profile-bot.ts
//
// Pushes a wallet's staged profile (username/bio) live to Pump.fun. Reuses
// the auth/proxy/Cloudflare-block plumbing from pumpfun-client.ts — same
// cookie-based wallet-signature login already confirmed live for callouts.
//
// Endpoint shapes below were discovered live 2026-09-09 against a real test
// wallet (probed, verified, and reverted before/after — see chat history,
// not committed as a script). Every reference-bot pattern for "post a
// signature+timestamp directly in the write body" turned out to be wrong for
// this flow, same lesson as comment-bot.ts's own header: the real mechanism
// is cookie-authenticated writes after a separate /auth/login call.
//
//   1. GET  frontend-api-v3.pump.fun/users/{address}, cookie-authed ->
//      {username, bio, profile_image, ...}. Every wallet that has EVER
//      logged in already has a profile — pump.fun auto-assigns a random
//      username ("ApeEasyCongress"-style) and a default "pumpatar" avatar on
//      first login. There's no "does this wallet have a profile yet" check —
//      only "has it been customized."
//   2. POST frontend-api-v3.pump.fun/users, authed with BOTH the auth_token
//      cookie AND `Authorization: Bearer {auth_token}` — cookie alone 404s
//      every write path tried; the bearer header is what actually unlocks
//      the write route. Body: {username, bio, profileImage} — note the
//      camelCase profileImage on write vs snake_case profile_image on read,
//      an asymmetry, not a typo. Returns 201 with the updated profile.
//   3. bio (and presumably username) pass through real content moderation —
//      confirmed live: a value containing "__probe_marker__" was rejected
//      with 400 "Content did not pass our guidelines". Surface 400s to the
//      caller as real rejections, not bugs.
//   4. profileImage is validated as "a valid IPFS or CDN URL" — confirmed
//      live that this REJECTS a plain S3 bucket URL (our own upload
//      target for wallet_profiles.avatar_url). No working upload path to an
//      accepted host was found in this pass (pump.fun/api/ipfs, the classic
//      Pinata-backed token-image upload endpoint, is reachable but 500s
//      regardless of payload shape tried — likely deprecated or requires a
//      call shape not yet discovered). So: avatar sync to Pump.fun is NOT
//      wired here — updatePumpFunProfileForWallet only ever sends
//      username/bio, deliberately never avatarUrl, until a working image
//      host is found. Wire it in once one is.

import { Keypair } from '@solana/web3.js'
import { fetch as proxyFetch, type Dispatcher } from 'undici'
import { getWalletKeypairById } from '@/lib/vault/get-wallet-by-id'
import {
  PUMPFUN_API, BROWSER_HEADERS, withProxyRetry, loginToPumpFun, readJsonOrThrowIfBlocked,
} from '@/lib/pumpfun/pumpfun-client'

export interface PumpFunProfileFields {
  username?:  string
  bio?:       string
  /** Must already be hosted on a host Pump.fun accepts (IPFS/their own CDN)
   *  — a plain S3 URL is rejected. No working upload path to such a host is
   *  wired yet; omit this until one is found. */
  avatarUrl?: string
}

export interface UpdateProfileResult {
  success: boolean
  status?: number
  error?:  string
  raw?:    unknown
}

interface PumpFunUser {
  username?:      string
  bio?:           string
  profile_image?: string
}

async function fetchCurrentProfile(address: string, authToken: string, dispatcher: Dispatcher): Promise<PumpFunUser | null> {
  const res = await proxyFetch(`${PUMPFUN_API}/users/${address}`, {
    headers: { ...BROWSER_HEADERS, Cookie: `auth_token=${authToken}` },
    dispatcher,
  })
  if (!res.ok) return null
  return (await readJsonOrThrowIfBlocked(res, 'users/get')) as PumpFunUser | null
}

async function writeProfile(
  authToken: string,
  body: { username: string; bio: string; profileImage: string | null },
  dispatcher: Dispatcher,
): Promise<UpdateProfileResult> {
  const res = await proxyFetch(`${PUMPFUN_API}/users`, {
    method:  'POST',
    headers: { ...BROWSER_HEADERS, Cookie: `auth_token=${authToken}`, Authorization: `Bearer ${authToken}` },
    body:    JSON.stringify(body),
    dispatcher,
  })
  const raw = (await readJsonOrThrowIfBlocked(res, 'users/update')) as { message?: string | string[] } | null

  if (!res.ok) {
    const message = Array.isArray(raw?.message) ? raw.message.join('; ') : raw?.message
    return { success: false, status: res.status, error: message ?? `HTTP ${res.status}`, raw }
  }
  return { success: true, status: res.status, raw }
}

/**
 * Fetches the wallet's current live profile, merges the requested changes
 * on top (so omitted fields aren't clobbered — the write endpoint always
 * expects the full {username, bio, profileImage} triple, not a partial
 * patch), and pushes it. Caller owns the keypair's lifecycle.
 */
export async function updateProfileAsWallet(keypair: Keypair, fields: PumpFunProfileFields): Promise<UpdateProfileResult> {
  return withProxyRetry(async (dispatcher) => {
    const authToken = await loginToPumpFun(keypair, dispatcher)
    const address    = keypair.publicKey.toBase58()

    const current = await fetchCurrentProfile(address, authToken, dispatcher)
    if (!current) {
      return { success: false, error: 'Could not read current pump.fun profile before updating' }
    }

    return writeProfile(authToken, {
      username:     fields.username  ?? current.username ?? '',
      bio:          fields.bio       ?? current.bio       ?? '',
      profileImage: fields.avatarUrl ?? current.profile_image ?? null,
    }, dispatcher)
  })
}

/**
 * Same as updateProfileAsWallet, but resolves the keypair from Vault by
 * wallet UUID and wipes it afterward — the entry point API routes should use.
 */
export async function updatePumpFunProfileForWallet(
  walletId: string,
  fields:   PumpFunProfileFields,
): Promise<UpdateProfileResult> {
  const keypair = await getWalletKeypairById(walletId)
  try {
    return await updateProfileAsWallet(keypair, fields)
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err)
    console.error(`[profile-bot] updatePumpFunProfileForWallet failed wallet=${walletId}:`, error)
    return { success: false, error }
  } finally {
    keypair.secretKey.fill(0)
  }
}
