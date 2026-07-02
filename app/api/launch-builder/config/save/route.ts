// app/api/launch-builder/config/route.ts

import { NextRequest, NextResponse } from 'next/server'
import { createClient }              from '@/lib/supabase/server'

export async function POST(req: NextRequest) {
  const supabase = await createClient()

  const { data: { user }, error: authErr } = await supabase.auth.getUser()
  if (authErr || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await req.json()

  // pass jsonb params as raw JS objects — NOT JSON.stringify()
  const { data, error } = await supabase.rpc('save_launch_config', {
    p_id:               body.id            ?? null,   // null = create
    p_name:             body.name          ?? null,
    p_description:      body.description    ?? null,
    p_launch_type:      body.launchType    ?? 'block0',
    p_graph:            body.graph         ?? {},     // raw object
    p_settings:         body.settings      ?? {},     // raw object
    p_token_mint_id:    body.tokenMintId   ?? null,
    p_status:           body.status        ?? null,
    p_expected_version: body.expectedVersion ?? null  // concurrency guard
  })

  if (error) {
    // Version conflict → 409 so the client can prompt a reload
    if (error.message.includes('Version conflict')) {
      return NextResponse.json({ error: error.message }, { status: 409 })
    }
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json(data, { status: 200 })
}