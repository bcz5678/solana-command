// app/api/domains/setup/callback/route.ts

import { NextRequest, NextResponse } from 'next/server'
import { applyProgress }             from '@/lib/domains/setup-jobs'
import type {
  StepStatus,
  DomainSetupJobStatus,
}                                     from '@/lib/domains/setup-jobs'

// ── POST /api/domains/setup/callback ─────────────────────────────
// Called by the offsite n8n flow — potentially several times per job —
// to report progress on an individual step or the job as a whole.
// There's no Supabase session on these requests (n8n isn't a signed-in
// user), so auth is a shared secret handed to n8n in the initial
// /api/domains/setup payload and echoed back here.
export async function POST(req: NextRequest) {

  const secret = process.env.N8N_CALLBACK_SECRET
  if (!secret) {
    return NextResponse.json({ error: 'N8N_CALLBACK_SECRET is not configured' }, { status: 500 })
  }

  const provided = req.headers.get('x-webhook-secret')
  if (provided !== secret) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let body: {
    jobId?:     string
    step?:      string
    status?:    StepStatus
    message?:   string
    jobStatus?: DomainSetupJobStatus
  }

  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  if (!body.jobId) {
    return NextResponse.json({ error: 'jobId is required' }, { status: 400 })
  }

  const job = applyProgress(body.jobId, {
    step:      body.step,
    status:    body.status,
    message:   body.message,
    jobStatus: body.jobStatus,
  })

  if (!job) {
    return NextResponse.json({ error: 'Unknown jobId' }, { status: 404 })
  }

  return NextResponse.json({ ok: true, job }, { status: 200 })
}
