// app/api/domains/distributions/route.ts

import { NextResponse }        from 'next/server'
import { createClient }        from '@/lib/supabase/server'
import { listDistributions }   from '@/lib/domains/cloudfront'

// ── GET /api/domains/distributions ───────────────────────────────
// Lists CloudFront distributions available to attach a site's domain to,
// including each one's current origin path — assigning a distribution
// to a new site overwrites that path, so the UI shows it up front.
export async function GET() {

  const supabase = await createClient()

  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const distributions = await listDistributions()
    return NextResponse.json({ distributions }, { status: 200 })
  } catch (error) {
    console.error('[domains/distributions] error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to list CloudFront distributions' },
      { status: 502 },
    )
  }
}
