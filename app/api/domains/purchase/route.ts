// app/api/domains/purchase/route.ts

import { NextRequest, NextResponse } from 'next/server'
import { createHmac }                from 'node:crypto'
import { createClient }              from '@/lib/supabase/server'

// Namecheap's domains.create routinely runs 10–30s, and non-real-time TLDs
// longer. The old 15s ceiling produced false timeouts on an irreversible
// operation, which invited a retry that bought the domain twice.
//
// Overridable via env for testing the timeout branch on demand (see the
// domain-purchase-webhook-stub route) — never meant to be set in production.
const TIMEOUT_MS = Number(process.env.DOMAIN_PURCHASE_TIMEOUT_MS) || 90_000

// Mirrors the `status` values the workflow's Classify node emits.
type WorkflowStatus =
  | 'registered'        // bought, live now
  | 'already_owned'     // getList guard hit — no charge, treated as success
  | 'pending_registry'  // NonRealTimeDomain; order placed, registry confirming
  | 'failed'            // Namecheap rejected (taken, funds, verification)

interface WorkflowResult {
  ok: boolean
  status: WorkflowStatus
  domain: string
  orderId?: string
  transactionId?: string
  chargedAmount?: number
  message?: string
  namecheapErrorCode?: string | null
}

interface ProvisioningEventLite {
  step: string
  status: string
  detail: Record<string, unknown>
  at: string
}

interface ProvisioningRunLite {
  id: string
  kind: string
  status: string
  domain: string
  events: ProvisioningEventLite[]
}

// ── POST /api/domains/purchase ───────────────────────────────────
// Site-scoped. Starts (or resumes) a `purchase` provisioning run, records
// `domain_purchase` events against it, then hands registration to the
// offsite n8n webhook, which owns the Namecheap call and the WHOIS/contact
// block. This route holds no registrar credentials — it is a signed,
// authenticated proxy plus the app-side half of the run's event trail.
export async function POST(req: NextRequest) {

  const supabase = await createClient()

  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let body: { siteId?: string; domain?: string; years?: number; expectedPriceUsd?: number }

  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const siteId = body.siteId?.trim()
  if (!siteId) {
    return NextResponse.json({ error: 'siteId is required' }, { status: 400 })
  }

  // Normalize here rather than in the workflow — the Set Config node splits on
  // the first dot and throws on a malformed value, which surfaces as an opaque
  // 502 instead of a 400 the wizard can render inline.
  const domain = body.domain?.trim().toLowerCase()
  if (!domain || !/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(domain)) {
    return NextResponse.json({ error: 'A valid domain is required' }, { status: 400 })
  }

  // Years is bounded because it is a multiplier on an irreversible charge.
  const years = Number.isInteger(body.years) ? Math.min(Math.max(body.years!, 1), 10) : 1

  const webhookUrl    = process.env.N8N_DOMAIN_PURCHASE_WEBHOOK_URL
  // One outbound secret, same as the provisioning dispatcher: shared bearer in
  // x-n8n-webhook-secret and HMAC key for x-signature. INTERNAL_API_SECRET is
  // the inbound counterpart and has no role here — this workflow responds
  // synchronously rather than calling back into the app.
  const webhookSecret = process.env.N8N_WEBHOOK_SECRET

  if (!webhookUrl || !webhookSecret) {
    return NextResponse.json(
      { error: 'Domain purchase webhook is not configured' },
      { status: 500 },
    )
  }

  // The attempt component only advances past a CONFIRMED terminal outcome for
  // this exact (site, domain) — 'failed' (a clean decline) or 'cancelled' (an
  // operator abandoned a blocked run — see Fix 1's own closing line: abandon
  // is supposed to free up a fresh attempt). 'blocked', 'running' and 'queued'
  // must NOT advance it, or a resubmit after a timeout mints a new key, opens
  // a new run, and buys the domain a second time — which is the exact failure
  // mode the started-before-call guard exists to prevent. Computed here, from
  // the DB, never from anything the client sends: a client that could
  // increment its own attempt number could bypass idempotency entirely.
  const attempt = await computeAttemptNumber(supabase, siteId, domain)
  const idempotencyKey = `purchase:${siteId}:${domain}:${attempt}`

  const { data: startResult, error: startError } = await supabase.rpc('start_domain_purchase', {
    p_site_id: siteId,
    p_domain: domain,
    p_idempotency_key: idempotencyKey,
  })

  if (startError) {
    const message = startError.message ?? ''

    if (message.includes('not owned by caller')) {
      return NextResponse.json({ error: 'Site not found' }, { status: 404 })
    }
    if (message.includes('is live on site')) {
      return NextResponse.json({ error: message }, { status: 409 })
    }
    if (message.includes('already been purchased')) {
      return NextResponse.json({ error: message }, { status: 422 })
    }

    console.error('[domains/purchase] start_domain_purchase failed:', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }

  const start = startResult as { run_id: string; status: string; duplicate: boolean }
  const runId = start.run_id

  // ── Duplicate: an attempt for this exact (site, domain, attempt) already
  // has a run. Never call the webhook again here — reconcile from what that
  // run already recorded instead of risking a second charge.
  if (start.duplicate) {
    return await reconcileDuplicate(supabase, siteId, runId, domain)
  }

  // ── Fresh run: record `started` before the irreversible call. This is the
  // guard the old orchestrator-driven purchase run relied on n8n for — here
  // the route itself is the one making the outbound call, so it is the one
  // that must record it first.
  const { error: startedError } = await supabase.rpc('record_domain_purchase_event', {
    p_run_id: runId,
    p_status: 'started',
    p_detail: { domain, years, expectedPriceUsd: body.expectedPriceUsd ?? null },
  })

  if (startedError) {
    // Should not happen — start_domain_purchase just created this run fresh,
    // so guard 5 (duplicate started) cannot fire. Log loudly and refuse to
    // proceed rather than call the webhook with no started record behind it.
    console.error('[domains/purchase] failed to record started event:', startedError.message, { runId })
    return NextResponse.json(
      { error: 'Could not record the purchase attempt — refusing to call the registrar', status: 'unknown', runId },
      { status: 500 },
    )
  }

  // Serialize once and sign those exact bytes. Signing a re-serialization of
  // the parsed object is the classic mismatch — key order is not guaranteed
  // to survive a parse/stringify round trip.
  const payload = JSON.stringify({ domain_name: domain, years })

  const signature = createHmac('sha256', webhookSecret)
    .update(payload)
    .digest('hex')

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)

  try {
    // Info level, unconditional — so a stub left pointed at in a later
    // session (see DOMAIN_PURCHASE_TIMEOUT_MS above) announces itself in the
    // logs instead of silently absorbing what looks like a real purchase.
    console.info('[domains/purchase] dispatching to', new URL(webhookUrl).host)

    const res = await fetch(webhookUrl, {
      method: 'POST',
      headers: {
        'Content-Type':         'application/json',
        'x-n8n-webhook-secret': webhookSecret,
        'x-signature':          signature,
      },
      body: payload,
      signal: controller.signal,
    })

    if (!res.ok) {
      // 401/403/404 mean the request was rejected at the gateway — a bad
      // secret or a bad path. It never reached the create node, so this is a
      // clean, fixable failure (the developer fixes config and tries again),
      // not an ambiguous one that needs an operator to check Namecheap.
      if (res.status === 401 || res.status === 403 || res.status === 404) {
        return await recordFailedAndRespond(
          supabase, runId, domain,
          `purchase workflow rejected the request (${res.status}) — it never reached the create node`,
          null, 502,
        )
      }

      // Any other non-2xx (5xx, etc.) — the workflow ran and broke somewhere,
      // and which side of the Namecheap call it broke on is not knowable from
      // here. The workflow answers 200 for business failures, so this is
      // genuinely infrastructural, but "infrastructural" is not the same as
      // "safe" when we cannot rule out the call having fired.
      return await recordBlockedAndRespond(
        supabase, runId, domain,
        `purchase workflow returned ${res.status}`,
        502,
      )
    }

    const result = await res.json().catch(() => null) as WorkflowResult | null

    if (!result || typeof result.ok !== 'boolean') {
      return await recordBlockedAndRespond(
        supabase, runId, domain,
        'malformed response from purchase workflow',
        502,
      )
    }

    if (!result.ok) {
      // 422: the request was well-formed, the registrar declined it. Pass the
      // Namecheap message through — "domain is taken" and "insufficient funds"
      // need different UI, and only the message distinguishes them.
      return await recordFailedAndRespond(
        supabase, runId, domain,
        result.message ?? 'Registrar declined the purchase',
        result.namecheapErrorCode ?? null,
        422,
      )
    }

    if (result.status === 'pending_registry') {
      // Known state, not an ambiguous one — but it still means "don't advance
      // to setup," which is exactly what a blocked run communicates to the
      // rest of the system (and to resolve_provisioning_block, whenever the
      // registry confirms and an operator or a future poll clears it).
      const { error: blockedError } = await supabase.rpc('record_domain_purchase_event', {
        p_run_id: runId,
        p_status: 'blocked',
        p_detail: { reason: 'registry confirming', domain, orderId: result.orderId ?? null },
      })
      if (blockedError) console.error('[domains/purchase] failed to record blocked event:', blockedError.message, { runId })

      return NextResponse.json(
        {
          ok: true,
          status: 'pending_registry',
          domain: result.domain ?? domain,
          orderId: result.orderId ?? null,
          transactionId: null,
          chargedAmount: result.chargedAmount ?? null,
          settled: false,
          runId,
        },
        { status: 200 },
      )
    }

    // registered | already_owned
    const { error: succeededError } = await supabase.rpc('record_domain_purchase_event', {
      p_run_id: runId,
      p_status: 'succeeded',
      p_detail: result.status === 'already_owned'
        ? { domain, reason: 'already in account' }
        : { orderId: result.orderId ?? null, transactionId: result.transactionId ?? null, chargedAmount: result.chargedAmount ?? null, domain },
    })
    if (succeededError) console.error('[domains/purchase] failed to record succeeded event:', succeededError.message, { runId })

    return NextResponse.json(
      {
        ok:            true,
        status:        result.status,
        domain:        result.domain ?? domain,
        orderId:       result.orderId       ?? null,
        transactionId: result.transactionId ?? null,
        chargedAmount: result.chargedAmount ?? null,
        settled:       true,
        runId,
      },
      { status: 200 },
    )

  } catch (err) {
    const classification = classifyDispatchError(err)

    if (classification.status === 'failed') {
      return await recordFailedAndRespond(supabase, runId, domain, classification.reason, null, classification.httpStatus)
    }
    return await recordBlockedAndRespond(supabase, runId, domain, classification.reason, classification.httpStatus)

  } finally {
    clearTimeout(timer)
  }
}

type ErrorClassification =
  | { status: 'failed'; reason: string; httpStatus: 502 }
  | { status: 'blocked'; reason: string; httpStatus: 502 | 504 }

/**
 * Splits a thrown fetch error into "confirmed never left the app" (failed —
 * fixable, not ambiguous) vs "cannot rule out the call having fired" (blocked).
 *
 * AbortError is always `blocked` — a timeout is the textbook ambiguous case.
 * A connection-level error is `failed` only when Node's cause code confirms
 * the socket never connected (ECONNREFUSED, DNS failure) — those happen
 * before a single byte is written. Anything else, including a reset on an
 * already-open connection, cannot be told apart from "died after sending" at
 * the fetch API level, so it defaults to `blocked`: conservative is correct
 * when the ambiguity is real.
 */
function classifyDispatchError(err: unknown): ErrorClassification {
  if (err instanceof Error && err.name === 'AbortError') {
    return {
      status: 'blocked',
      reason: 'The registrar did not respond in time. The purchase may still have completed.',
      httpStatus: 504,
    }
  }

  const cause = err instanceof Error && 'cause' in err
    ? (err.cause as { code?: string } | undefined)
    : undefined
  const code = cause?.code

  if (code === 'ECONNREFUSED' || code === 'ENOTFOUND' || code === 'EAI_AGAIN') {
    return {
      status: 'failed',
      reason: `Could not reach the purchase workflow (${code}) — the request never left the app`,
      httpStatus: 502,
    }
  }

  return {
    status: 'blocked',
    reason: 'Could not reach the purchase workflow',
    httpStatus: 502,
  }
}

/**
 * Confirmed, unambiguous failure — the registrar declined (422), or the
 * request never reached Namecheap at all (502: bad secret, bad DNS, refused
 * connection). Safe to record as `failed` rather than `blocked`: nothing
 * about retrying this is risky once whatever's wrong is fixed.
 */
async function recordFailedAndRespond(
  supabase: Awaited<ReturnType<typeof createClient>>,
  runId: string,
  domain: string,
  reason: string,
  code: string | null,
  httpStatus: 422 | 502,
) {
  const { error: failedError } = await supabase.rpc('record_domain_purchase_event', {
    p_run_id: runId,
    p_status: 'failed',
    p_detail: { message: reason, namecheapErrorCode: code, domain },
  })
  if (failedError) console.error('[domains/purchase] failed to record failed event:', failedError.message, { runId })

  return NextResponse.json(
    { ok: false, status: 'failed', domain, error: reason, code, runId },
    { status: httpStatus },
  )
}

/**
 * Records the run as `blocked` (never `failed` — that would tell the system
 * the purchase did not happen, which is the one thing nobody knows) and
 * returns the `unknown` response shape. Shared by every path where we cannot
 * rule out the Namecheap call having fired.
 */
async function recordBlockedAndRespond(
  supabase: Awaited<ReturnType<typeof createClient>>,
  runId: string,
  domain: string,
  reason: string,
  httpStatus: 502 | 504,
) {
  const { error: blockedError } = await supabase.rpc('record_domain_purchase_event', {
    p_run_id: runId,
    p_status: 'blocked',
    p_detail: { reason, domain },
  })
  if (blockedError) console.error('[domains/purchase] failed to record blocked event:', blockedError.message, { runId })

  return NextResponse.json(
    { ok: false, status: 'unknown', domain, error: reason, runId },
    { status: httpStatus },
  )
}

/**
 * Counts prior `purchase` runs for this exact (site, domain) that reached a
 * CONFIRMED terminal outcome — `failed` (a clean decline) or `cancelled` (an
 * operator abandoned a blocked run). That count IS the next attempt number:
 * the first attempt is 0, and it only advances once something definitive
 * happened. `blocked`, `running`, and `queued` do not count — a resubmit
 * while one of those is outstanding must collide with it, not open a new run.
 *
 * On a read failure this fails closed at 0 rather than guessing high: at
 * worst that re-collides with an existing run and goes through
 * reconcileDuplicate, which is always safe. Guessing high risks minting a key
 * nothing has claimed yet and calling the webhook uncontested.
 */
async function computeAttemptNumber(
  supabase: Awaited<ReturnType<typeof createClient>>,
  siteId: string,
  domain: string,
): Promise<number> {
  const { data, error } = await supabase.rpc('get_provisioning_status', { p_site_id: siteId })

  if (error) {
    console.error('[domains/purchase] failed to read run history for idempotency key:', error.message)
    return 0
  }

  const runs = (data as { runs: ProvisioningRunLite[] }).runs ?? []

  return runs.filter((r) =>
    r.kind === 'purchase' &&
    r.domain === domain &&
    (r.status === 'failed' || r.status === 'cancelled'),
  ).length
}

/**
 * A duplicate `start_domain_purchase` call means an attempt for this exact
 * (site, domain, attempt) already has a run — reconstruct the response from
 * what that run already recorded instead of calling the webhook a second time.
 */
async function reconcileDuplicate(
  supabase: Awaited<ReturnType<typeof createClient>>,
  siteId: string,
  runId: string,
  domain: string,
) {
  const { data, error } = await supabase.rpc('get_provisioning_status', { p_site_id: siteId })

  if (error) {
    console.error('[domains/purchase] duplicate reconcile: status lookup failed:', error.message, { runId })
    return NextResponse.json(
      { ok: false, status: 'unknown', domain, error: 'A previous attempt exists but its state could not be read — check the run directly.', runId },
      { status: 502 },
    )
  }

  const run = ((data as { runs: ProvisioningRunLite[] }).runs ?? []).find((r) => r.id === runId)

  if (!run) {
    console.error('[domains/purchase] duplicate reconcile: run not found in status', { runId })
    return NextResponse.json(
      { ok: false, status: 'unknown', domain, error: 'A previous attempt exists but could not be located — check the run directly.', runId },
      { status: 502 },
    )
  }

  const purchaseEvents = run.events.filter((e) => e.step === 'domain_purchase')
  const terminal = purchaseEvents.filter((e) => e.status !== 'started').at(-1)

  switch (run.status) {
    case 'completed': {
      const detail = terminal?.detail ?? {}
      const alreadyOwned = detail.reason === 'already in account'
      return NextResponse.json(
        {
          ok: true,
          status: alreadyOwned ? 'already_owned' : 'registered',
          domain,
          orderId: (detail.orderId as string) ?? null,
          transactionId: (detail.transactionId as string) ?? null,
          chargedAmount: (detail.chargedAmount as number) ?? null,
          settled: true,
          runId,
        },
        { status: 200 },
      )
    }
    case 'failed': {
      const detail = terminal?.detail ?? {}
      return NextResponse.json(
        {
          ok: false,
          status: 'failed',
          domain,
          error: (detail.message as string) ?? 'Registrar declined the purchase',
          code: (detail.namecheapErrorCode as string) ?? null,
          runId,
        },
        { status: 422 },
      )
    }
    case 'blocked':
      // Needs a human. Nothing resolves this without an operator checking
      // Namecheap and going through resolve_provisioning_block.
      return NextResponse.json(
        {
          ok: false,
          status: 'unknown',
          runStatus: 'blocked',
          domain,
          error: 'A previous attempt for this domain has not been confirmed — check the run before doing anything else.',
          runId,
        },
        { status: 502 },
      )
    default:
      // queued | running — genuinely still in flight (another tab, a race
      // that beat the disabled button). Transient: it resolves on its own
      // once the winning request completes. `runStatus` is what lets the
      // wizard tell this apart from `blocked` — showing the same "an
      // operator needs to check Namecheap" escalation for a race that
      // clears itself in a couple seconds is the difference between a user
      // waiting three seconds and a user filing a ticket.
      return NextResponse.json(
        {
          ok: false,
          status: 'unknown',
          runStatus: run.status,
          domain,
          error: 'A purchase attempt for this domain is already in progress and will resolve automatically.',
          runId,
        },
        { status: 502 },
      )
  }
}
