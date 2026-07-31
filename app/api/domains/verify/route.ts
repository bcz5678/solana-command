// app/api/domains/verify/route.ts

import { NextRequest, NextResponse } from 'next/server'
import { createClient }              from '@/lib/supabase/server'
import { verifyDomainOwnership }     from '@/lib/domains/namecheap'

// ── GET /api/domains/verify?domain=example.com ───────────────────
// Confirms `domain` appears in the Namecheap account's domain list —
// used for the "I already own a domain" path to catch typos/domains
// that aren't actually registered under the connected account.
export async function GET(req: NextRequest) {

  const supabase = await createClient()

  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { searchParams } = new URL(req.url)
  const domain = searchParams.get('domain')?.trim()

  if (!domain) {
    return NextResponse.json({ error: 'domain is required' }, { status: 400 })
  }

  try {
    const owned = await verifyDomainOwnership(domain)
    return NextResponse.json({ domain, owned }, { status: 200 })
  } catch (error) {
    console.error('[domains/verify] error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Domain ownership check failed' },
      { status: 502 },
    )
  }
}
