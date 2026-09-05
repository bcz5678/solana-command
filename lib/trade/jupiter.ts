import BN from 'bn.js'

// Free tier by default — set JUPITER_API_URL=https://api.jup.ag and JUPITER_API_KEY
// to switch to the paid tier (higher rate limits, priority routing).
const JUPITER_API_URL = process.env.JUPITER_API_URL ?? 'https://lite-api.jup.ag'

export const WRAPPED_SOL_MINT = 'So11111111111111111111111111111111111111112'

export interface JupiterQuote {
  inputMint: string
  outputMint: string
  inAmount: string
  outAmount: string
  [key: string]: unknown
}

interface JupiterSwapResponse {
  swapTransaction: string
  lastValidBlockHeight: number
}

export interface JupiterTokenInfo {
  id: string
  name: string
  symbol: string
  icon: string | null
  decimals: number
  totalSupply: number | null   // UI units, not raw
  [key: string]: unknown
}

async function jupiterFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const headers: Record<string, string> = { ...(init?.headers as Record<string, string> | undefined) }
  if (process.env.JUPITER_API_KEY) headers['x-api-key'] = process.env.JUPITER_API_KEY

  const res = await fetch(`${JUPITER_API_URL}${path}`, { ...init, headers })
  if (!res.ok) {
    throw new Error(`Jupiter ${path} failed: HTTP ${res.status} ${await res.text().catch(() => '')}`)
  }
  return res.json()
}

/** amount is in the input mint's raw units (lamports for SOL). */
export function getJupiterQuote(
  inputMint: string,
  outputMint: string,
  amount: BN,
  slippageBps: number,
): Promise<JupiterQuote> {
  const params = new URLSearchParams({
    inputMint,
    outputMint,
    amount: amount.toString(),
    slippageBps: String(slippageBps),
  })
  return jupiterFetch<JupiterQuote>(`/swap/v1/quote?${params}`)
}

/** Returns a fully-built, base64-encoded VersionedTransaction — sign and send it as-is. */
export function getJupiterSwapTransaction(quote: JupiterQuote, userPublicKey: string): Promise<JupiterSwapResponse> {
  return jupiterFetch<JupiterSwapResponse>('/swap/v1/swap', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ quoteResponse: quote, userPublicKey, wrapAndUnwrapSol: true }),
  })
}

/** Metadata fallback for mints pump.fun doesn't know about — name/symbol/icon/decimals. */
export async function searchJupiterToken(mint: string): Promise<JupiterTokenInfo | null> {
  try {
    const results = await jupiterFetch<JupiterTokenInfo[]>(`/tokens/v2/search?query=${encodeURIComponent(mint)}`)
    return results.find((r) => r.id === mint) ?? null
  } catch {
    return null
  }
}

// v2 (`/price/v2`, `{ data: Record<mint, {id, price}> }`) 404s as of 2026-09
// — Jupiter dropped it with no redirect. v3 dropped the `data` wrapper (the
// mint is the top-level key) and renamed `price` (a string) to `usdPrice`
// (a number). Confirmed live against lite-api.jup.ag before switching.
type JupiterPriceResponse = Record<string, { usdPrice: number } | undefined>

let cachedSolUsdPrice: { price: number; fetchedAt: number } | null = null
const SOL_USD_CACHE_TTL_MS = 30_000

/** Current SOL/USD price. Cached for 30s to avoid hammering Jupiter on every page load. */
export async function getSolUsdPrice(): Promise<number> {
  if (cachedSolUsdPrice && Date.now() - cachedSolUsdPrice.fetchedAt < SOL_USD_CACHE_TTL_MS) {
    return cachedSolUsdPrice.price
  }

  const res = await jupiterFetch<JupiterPriceResponse>(`/price/v3?ids=${WRAPPED_SOL_MINT}`)
  const price = res[WRAPPED_SOL_MINT]?.usdPrice ?? NaN
  if (!Number.isFinite(price) || price <= 0) {
    throw new Error('Jupiter price/v3 returned no usable SOL price')
  }

  cachedSolUsdPrice = { price, fetchedAt: Date.now() }
  return price
}
