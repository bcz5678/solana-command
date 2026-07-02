import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function POST(req: NextRequest) {
  const supabase = await createClient()

  const { data: { user }, error: authErr } = await supabase.auth.getUser()
  if (authErr || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()

  const { data, error } = await supabase.rpc('save_launch_template', {
    p_id:          body.id          ?? null,
    p_name:        body.name        ?? 'Untitled Template',
    p_description: body.description ?? null,
    p_launch_type: body.launchType  ?? null,
    p_graph:       body.graph       ?? {},
    p_settings:    body.settings    ?? {},
    p_is_shared:   body.isShared    ?? false,
  })

  if (error) {
    console.error('[launch-builder/template/save]', error)
    return NextResponse.json(
      { error: error.message, code: error.code, hint: error.hint, details: error.details },
      { status: 500 },
    )
  }

  return NextResponse.json(data, { status: 200 })
}
