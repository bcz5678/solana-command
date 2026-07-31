// app/api/domains/purchase/route.ts

import { NextRequest, NextResponse } from 'next/server'
import { createClient }              from '@/lib/supabase/server'
import {
  purchaseDomain,
  missingContactFields,
  NamecheapContact,
}                                     from '@/lib/domains/namecheap'

// ── POST /api/domains/purchase ───────────────────────────────────
// Registers `domain` through Namecheap for the given `contact` (required —
// Namecheap needs full WHOIS registrant info for every registration).
// Shell for now: no billing/checkout wired up yet, so this just performs
// the registration call once a caller supplies contact details.
export async function POST(req: NextRequest) {

  const supabase = await createClient()

  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let body: {
    domain?:  string
    years?:   number
    contact?: Partial<NamecheapContact>
  }

  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const { domain, years = 1, contact } = body

  if (!domain || !domain.trim()) {
    return NextResponse.json({ error: 'domain is required' }, { status: 400 })
  }

  if (!contact) {
    return NextResponse.json({ error: 'contact is required to register a domain' }, { status: 400 })
  }

  const missing = missingContactFields(contact)
  if (missing.length > 0) {
    return NextResponse.json({ error: `Missing contact fields: ${missing.join(', ')}` }, { status: 400 })
  }

  try {
    const result = await purchaseDomain(domain.trim(), years, contact as NamecheapContact)
    return NextResponse.json({ result }, { status: 200 })
  } catch (error) {
    console.error('[domains/purchase] error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Domain purchase failed' },
      { status: 502 },
    )
  }
}
