// app/api/domains/search/route.ts

import { NextRequest, NextResponse } from 'next/server'
import { createClient }              from '@/lib/supabase/server'
import { searchDomains }             from '@/lib/domains/namecheap'

// ── GET /api/domains/search?query=name&tlds=com,xyz ─────────────
// Checks availability (and 1yr price, when available) for `query` across
// a TLD list via the Namecheap API. Defaults to a small starter TLD set.
export async function GET(req: NextRequest) {

  const supabase = await createClient()

  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { searchParams } = new URL(req.url)
  const query = searchParams.get('query')?.trim()

  if (!query) {
    return NextResponse.json({ error: 'query is required' }, { status: 400 })
  }

  const tldsParam = searchParams.get('tlds')
  const tlds = tldsParam
    ? tldsParam.split(',').map((t) => t.trim()).filter(Boolean)
    : undefined

  try {
    const results = tlds ? await searchDomains(query, tlds) : await searchDomains(query)
    return NextResponse.json({ results }, { status: 200 })
  } catch (error) {
    console.error('[domains/search] error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Domain search failed' },
      { status: 502 },
    )
  }
}
