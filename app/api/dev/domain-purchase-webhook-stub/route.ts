// app/api/dev/domain-purchase-webhook-stub/route.ts
//
// Local stand-in for the n8n "Token - Domain Purchase" webhook, for testing
// app/api/domains/purchase/route.ts's response-handling branches on demand.
// Namecheap sandbox can't be asked for a pending_registry, a malformed 200,
// a 5xx-after-dispatch, or a hang past timeout — this can.
//
// Scenario selection travels in the one channel the real caller doesn't fix:
// domain_name. route.ts's outgoing request (URL from env, fixed headers,
// {domain_name, years} body) is entirely production-shaped — no test-only
// query param or header was added to it — so the domain being "purchased" IS
// the scenario selector. Submit a domain starting with one of the tags below.
//
// Deliberately does NOT verify x-n8n-webhook-secret/x-signature. Signature
// verification is Stage 1's job against the real n8n workflow; re-checking
// Node's own HMAC output here would only test itself. This stub exists
// purely for response-shape coverage.
//
// Refuses to run outside development, so a stub left configured can never
// silently serve a production purchase attempt.

import { NextRequest, NextResponse } from 'next/server'

const SCENARIOS = [
  'stub-registered', 'stub-owned', 'stub-pending', 'stub-declined',
  'stub-malformed', 'stub-401', 'stub-5xx', 'stub-hang',
] as const

export async function POST(req: NextRequest) {
  if (process.env.NODE_ENV === 'production') {
    return NextResponse.json({ error: 'not available in production' }, { status: 404 })
  }

  const rawBody = await req.text()

  let body: { domain_name?: string; years?: number }
  try {
    body = JSON.parse(rawBody)
  } catch {
    return NextResponse.json({ error: 'invalid JSON' }, { status: 400 })
  }

  const domain = body.domain_name ?? ''
  const scenario = SCENARIOS.find((s) => domain.startsWith(s))

  if (!scenario) {
    return NextResponse.json(
      { error: `unrecognized stub scenario — domain must start with one of: ${SCENARIOS.join(', ')}` },
      { status: 400 },
    )
  }

  console.info('[domain-purchase-webhook-stub]', scenario, 'for', domain)

  switch (scenario) {
    case 'stub-registered':
      return NextResponse.json({
        ok: true, status: 'registered', domain,
        orderId: 'stub-order-1', transactionId: 'stub-txn-1', chargedAmount: 12.98,
      })

    case 'stub-owned':
      return NextResponse.json({ ok: true, status: 'already_owned', domain })

    case 'stub-pending':
      return NextResponse.json({ ok: true, status: 'pending_registry', domain, orderId: 'stub-order-2' })

    case 'stub-declined':
      return NextResponse.json({
        ok: false, status: 'failed', domain,
        message: 'Domain is already registered', namecheapErrorCode: 'STUB.2011166',
      })

    case 'stub-malformed':
      // 200, but not the documented shape at all — no `ok` field.
      return NextResponse.json({ unexpected: 'shape' })

    case 'stub-401':
      return NextResponse.json({ error: 'unauthorized (stub)' }, { status: 401 })

    case 'stub-5xx':
      return NextResponse.json({ error: 'workflow crashed (stub)' }, { status: 500 })

    case 'stub-hang':
      // Comfortably longer than any realistic test TIMEOUT_MS; the caller's
      // AbortController fires well before this resolves.
      await new Promise((resolve) => setTimeout(resolve, 15_000))
      return NextResponse.json({ ok: true, status: 'registered', domain })
  }
}
