import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function POST(req: NextRequest) {
  const supabase = await createClient()

  const { data: { user }, error: authErr } = await supabase.auth.getUser()
  if (authErr || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()

  const { data, error } = await supabase
    .from('launch_templates')
    .upsert({
      ...(body.id ? { id: body.id } : {}),
      user_id:     user.id,
      name:        body.name        ?? 'Untitled Template',
      description: body.description ?? null,
      launch_type: body.launchType  ?? null,
      graph:       body.graph       ?? {},
      settings:    body.settings    ?? {},
      is_shared:   body.isShared    ?? false,
    })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json(data, { status: 200 })
}
