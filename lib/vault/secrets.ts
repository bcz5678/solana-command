// src/vault/secrets.ts
// Single place secrets are fetched — nowhere else in the codebase

interface ExchangeCredentials {
  apiKey: string
  apiSecret: string
}

/**
 * Fetches exchange credentials from the appropriate secret store.
 * In production: Supabase secrets (injected as ENV at Edge Function runtime)
 * In local dev:  .env file (never committed)
 *
 * Keys are returned as strings and should be used immediately,
 * not stored in any persistent state or logged.
 */
export function getExchangeCredentials(exchange: string): ExchangeCredentials {
  const key    = Deno.env.get(`${exchange.toUpperCase()}_API_KEY`)
  const secret = Deno.env.get(`${exchange.toUpperCase()}_API_SECRET`)

  if (!key || !secret) {
    // Intentionally vague error — don't leak which key is missing in logs
    throw new Error(`Missing credentials for exchange: ${exchange}`)
  }

  return { apiKey: key, apiSecret: secret }
}

/**
 * Explicitly zeroes out credential strings after use.
 * JS strings are immutable so this is best-effort, but signals intent
 * and prevents accidental logging of the object.
 */
export function discardCredentials(creds: ExchangeCredentials): void {
  // Overwrite references — GC will handle the rest
  creds.apiKey    = ''
  creds.apiSecret = ''
}