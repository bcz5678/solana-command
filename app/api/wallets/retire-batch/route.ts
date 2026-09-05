import { PublicKey } from '@solana/web3.js'
import { NextRequest } from 'next/server'
import { requireSuperAdmin } from '@/lib/auth/require-super-admin'
import { createClient } from '@/lib/supabase/server'
import { handleError, initializeQuickNodeSolana, parseAndValidateAddress } from '@/app/api/utils/helpers'
import { retireWallet, type RetireOutcome } from '@/lib/wallet/retire'

export const dynamic    = 'force-dynamic'
export const maxDuration = 600

interface RetireBatchBody {
  walletIds?:          string[]
  destinationAddress?: string
  feePayerWalletId?:  string
}

// Hard ceiling per wallet — without this, one wallet stuck on a slow/hanging
// RPC call (a blockhash that never confirms, a dropped connection) would
// stall every wallet behind it with no way to tell "still working" from
// "silently died". retireWallet() re-checks live on-chain state on every
// call, so timing one out and moving on is safe to retry later — a
// still-in-flight close/sweep tx either already landed (next attempt sees
// the account closed / balance swept and just continues) or it didn't.
const PER_WALLET_TIMEOUT_MS = 90_000

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms)
    promise.then(
      (v) => { clearTimeout(timer); resolve(v) },
      (e) => { clearTimeout(timer); reject(e) },
    )
  })
}

export async function POST(req: NextRequest) {
  try {
    await requireSuperAdmin()
  } catch (res) {
    return res as Response
  }

  let body: RetireBatchBody
  try {
    body = await req.json()
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON body' }), { status: 400, headers: { 'Content-Type': 'application/json' } })
  }

  const { walletIds, destinationAddress, feePayerWalletId } = body
  if (!Array.isArray(walletIds) || walletIds.length === 0 || !destinationAddress) {
    return new Response(JSON.stringify({ error: 'walletIds and destinationAddress are required' }), { status: 400, headers: { 'Content-Type': 'application/json' } })
  }

  let destination: PublicKey
  try {
    destination = await parseAndValidateAddress(destinationAddress)
  } catch (err) {
    return handleError(err)
  }

  const connection = initializeQuickNodeSolana().connection
  const supabase = await createClient()

  // Streamed as newline-delimited JSON — one 'running' line when a wallet
  // starts, one final line when it resolves — so the browser can show
  // per-wallet progress instead of staring at a blank screen until the
  // entire batch (which can take minutes across many wallets) finishes.
  const encoder = new TextEncoder()
  const stream = new ReadableStream({
    async start(controller) {
      console.log(`[wallet-retire] batch starting — ${walletIds.length} wallet(s) -> ${destination.toBase58()}`)
      for (const walletId of walletIds) {
        controller.enqueue(encoder.encode(JSON.stringify({ walletId, status: 'running' }) + '\n'))

        let result: RetireOutcome
        try {
          result = await withTimeout(
            retireWallet(connection, supabase, walletId, destination, feePayerWalletId),
            PER_WALLET_TIMEOUT_MS,
            `Timed out after ${PER_WALLET_TIMEOUT_MS / 1000}s — it may still land on-chain; re-check the wallet before retrying.`,
          )
        } catch (err) {
          result = { success: false, error: err instanceof Error ? err.message : 'Unknown error' }
        }

        controller.enqueue(encoder.encode(JSON.stringify({
          walletId,
          status: result.success ? 'success' : 'error',
          ...result,
        }) + '\n'))
      }
      console.log(`[wallet-retire] batch done — ${walletIds.length} wallet(s) processed`)
      controller.close()
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type':  'application/x-ndjson',
      'Cache-Control': 'no-cache',
    },
  })
}
