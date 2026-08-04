// app/api/domains/purchase/route.ts

import { NextRequest, NextResponse } from 'next/server'
import { createClient }              from '@/lib/supabase/server'

const TIMEOUT_MS = 15_000

// ── POST /api/domains/purchase ───────────────────────────────────
// Hands the domain registration off to the offsite n8n webhook (which
// drives the actual Namecheap purchase + WHOIS/contact details) rather
// than calling Namecheap directly from here.
export async function POST(req: NextRequest) {

  const supabase = await createClient()

  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let body: { domain?: string }

  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const domain = body.domain?.trim()
  if (!domain) {
    return NextResponse.json({ error: 'domain is required' }, { status: 400 })
  }

  const webhookUrl = process.env.N8N_DOMAIN_PURCHASE_WEBHOOK_URL
  if (!webhookUrl) {
    return NextResponse.json({ error: 'N8N_DOMAIN_PURCHASE_WEBHOOK_URL is not configured' }, { status: 500 })
  }

  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)

    const res = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ domain_name: domain }),
      signal: controller.signal,
    })

    clearTimeout(timer)

    if (!res.ok) {
      return NextResponse.json({ error: `n8n webhook returned ${res.status}` }, { status: 502 })
    }

    const data = await res.json().catch(() => ({}))
    return NextResponse.json({ result: data }, { status: 200 })
  } catch (err) {
    const message = err instanceof Error && err.name === 'AbortError'
      ? 'n8n webhook timed out'
      : 'Failed to reach n8n webhook'
    return NextResponse.json({ error: message }, { status: 502 })
  }
}
