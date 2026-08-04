// app/api/domains/setup/route.ts

import { NextRequest, NextResponse } from 'next/server'
import { createClient }              from '@/lib/supabase/server'
import { createJob, markJobFailed }  from '@/lib/domains/setup-jobs'

const TIMEOUT_MS = 15_000

// ── POST /api/domains/setup ───────────────────────────────────────
// Kicks off the async domain configuration flow: creates a tracked job,
// then hands it to the offsite n8n webhook (which drives Namecheap DNS
// + CloudFront changes). n8n reports progress back via
// /api/domains/setup/callback as it works through the steps; poll
// /api/domains/setup/status?jobId= to follow along.
export async function POST(req: NextRequest) {

  const supabase = await createClient()

  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let body: {
    domain?:          string
    distributionId?:  string
    distributionUrl?: string
    originPath?:      string
    etag?:            string
  }

  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const { domain, distributionId, distributionUrl, originPath, etag } = body

  if (!domain?.trim())          return NextResponse.json({ error: 'domain is required' }, { status: 400 })
  if (!distributionId?.trim())  return NextResponse.json({ error: 'distributionId is required' }, { status: 400 })
  if (!distributionUrl?.trim()) return NextResponse.json({ error: 'distributionUrl is required' }, { status: 400 })
  if (!originPath?.trim())      return NextResponse.json({ error: 'originPath is required' }, { status: 400 })
  if (!etag?.trim())            return NextResponse.json({ error: 'etag is required' }, { status: 400 })

  const webhookUrl = process.env.N8N_DOMAIN_SETUP_WEBHOOK_URL
  if (!webhookUrl) {
    return NextResponse.json({ error: 'N8N_DOMAIN_SETUP_WEBHOOK_URL is not configured' }, { status: 500 })
  }

  const job = createJob({
    domain:          domain.trim(),
    distributionId:  distributionId.trim(),
    distributionUrl: distributionUrl.trim(),
    originPath:      originPath.trim(),
    etag:            etag.trim(),
  })

  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)

    // Keys here match the n8n workflow's required webhook fields exactly —
    // do not rename without updating the n8n flow too.
    const res = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        origin_path:      job.originPath,
        domain_name:      job.domain,
        distribution_url: job.distributionUrl,
        distribution_id:  job.distributionId,

        jobId:           job.id,
        etag:            job.etag,
        callbackUrl:     `${req.nextUrl.origin}/api/domains/setup/callback`,
        callbackSecret:  process.env.N8N_CALLBACK_SECRET ?? null,
      }),
      signal: controller.signal,
    })

    clearTimeout(timer)

    if (!res.ok) {
      const message = `n8n webhook returned ${res.status}`
      markJobFailed(job.id, message)
      return NextResponse.json({ error: message }, { status: 502 })
    }
  } catch (err) {
    const message = err instanceof Error && err.name === 'AbortError'
      ? 'n8n webhook timed out'
      : 'Failed to reach n8n webhook'
    markJobFailed(job.id, message)
    return NextResponse.json({ error: message }, { status: 502 })
  }

  return NextResponse.json({ jobId: job.id, job }, { status: 200 })
}
