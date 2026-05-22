// src/exchanges/binance.ts

import { getExchangeCredentials, discardCredentials } from '../vault/secrets.ts'

interface OrderParams {
  symbol:   string
  side:     'BUY' | 'SELL'
  type:     'MARKET' | 'LIMIT'
  quantity: number
  price?:   number
}

interface SignedRequest {
  url:     string
  headers: Record<string, string>
}

/**
 * Signs a Binance API request using HMAC-SHA256.
 * Credentials are fetched, used to sign, then discarded —
 * they are never attached to the returned object.
 */
async function signRequest(
  endpoint: string,
  params: Record<string, string | number>
): Promise<SignedRequest> {

  // 1. Fetch from vault into local scope only
  const creds = getExchangeCredentials('binance')

  try {
    // 2. Build query string
    const timestamp   = Date.now()
    const queryString = new URLSearchParams({
      ...Object.fromEntries(
        Object.entries(params).map(([k, v]) => [k, String(v)])
      ),
      timestamp: String(timestamp),
      recvWindow: '5000'
    }).toString()

    // 3. Sign with HMAC-SHA256 — happens entirely in memory
    const encoder   = new TextEncoder()
    const keyData   = encoder.encode(creds.apiSecret)  // secret used here
    const msgData   = encoder.encode(queryString)

    const cryptoKey = await crypto.subtle.importKey(
      'raw',
      keyData,
      { name: 'HMAC', hash: 'SHA-256' },
      false,           // not extractable — can't be read back out
      ['sign']
    )

    const signature = await crypto.subtle.sign('HMAC', cryptoKey, msgData)
    const sigHex    = Array.from(new Uint8Array(signature))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('')

    // 4. Return signed URL + API key header (NOT the secret)
    return {
      url: `https://api.binance.com${endpoint}?${queryString}&signature=${sigHex}`,
      headers: {
        'X-MBX-APIKEY': creds.apiKey,  // public API key is fine in header
        'Content-Type': 'application/json'
      }
    }

  } finally {
    // 5. Always discard — even if signing throws
    discardCredentials(creds)
  }
}

/**
 * Places an order on Binance.
 * Signing is handled internally — caller never touches credentials.
 */
export async function placeOrder(params: OrderParams): Promise<unknown> {
  const { url, headers } = await signRequest('/api/v3/order', {
    symbol:   params.symbol,
    side:     params.side,
    type:     params.type,
    quantity: params.quantity,
    ...(params.price && { price: params.price, timeInForce: 'GTC' })
  })

  const res = await fetch(url, { method: 'POST', headers })

  if (!res.ok) {
    // Never log the full URL — it contains the signature
    throw new Error(`Binance order failed: ${res.status} ${res.statusText}`)
  }

  return res.json()
}

/**
 * Fetches current account balances.
 */
export async function getBalances(): Promise<unknown> {
  const { url, headers } = await signRequest('/api/v3/account', {})
  const res = await fetch(url, { method: 'GET', headers })

  if (!res.ok) {
    throw new Error(`Binance balance fetch failed: ${res.status}`)
  }

  return res.json()
}