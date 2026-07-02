import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const supabase = await createClient()

  const { data: { user }, error: authErr } = await supabase.auth.getUser()
  if (authErr || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const id = new URL(req.url).searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })

  // get_launch_templates returns all accessible templates; filter to the requested id
  const { data, error } = await supabase.rpc('get_launch_templates')

  if (error) {
    console.error('[launch-builder/template/load]', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const template = Array.isArray(data) ? data.find((t: { id: string }) => t.id === id) : null
  if (!template) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  return NextResponse.json(template)
}
