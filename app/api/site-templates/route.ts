// app/api/site-templates/route.ts

import { NextRequest, NextResponse } from 'next/server'
import { createClient }              from '@/lib/supabase/server'
import { SiteTemplate }              from '@/lib/types/site-template'

// ── GET /api/site-templates ────────────────────────────────────
// List templates. ?active=true filters to active only.
export async function GET(req: NextRequest) {

  const supabase = await createClient()

  // Low-security, but still require a signed-in user (RLS expects it)
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { searchParams } = new URL(req.url)
  const activeOnly       = searchParams.get('active') === 'true'

  let query = supabase
    .from('site_templates')
    .select('id, name, description, template_json, is_active, created_at, updated_at, media_specs')
    .order('name')

  if (activeOnly) {
    query = query.eq('is_active', true)
  }

  const { data, error } = await query

  if (error) {
    console.error('[site-templates] list error:', error.message)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json(
    { templates: (data ?? []) as SiteTemplate[] },
    { status: 200 }
  )
}


// ── POST /api/site-templates ───────────────────────────────────
// Create a new template from the form.
export async function POST(req: NextRequest) {

  const supabase = await createClient()

  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let body: {
    name?:         string
    description?:  string | null
    templateJson?: unknown
    isActive?:     boolean
  }

  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  if (!body.name || !body.name.trim()) {
    return NextResponse.json({ error: 'name is required' }, { status: 400 })
  }

  const { data, error } = await supabase
    .from('site_templates')
    .insert({
      name:          body.name.trim(),
      description:   body.description ?? null,
      // raw object — Supabase serializes jsonb. Do NOT JSON.stringify().
      template_json: body.templateJson ?? {},
      is_active:     body.isActive ?? true
    })
    .select('id, name, description, template_json, is_active, created_at, updated_at, media_specs')
    .single()

  if (error) {
    console.error('[site-templates] create error:', error.message)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json(
    { template: data as SiteTemplate },
    { status: 201 }
  )
}
