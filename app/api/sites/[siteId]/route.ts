// app/api/site-templates/[id]/route.ts

import { NextRequest, NextResponse } from 'next/server'
import { createClient }              from '@/lib/supabase/server'
import { SiteTemplate }              from '@/lib/types/site-template'

interface RouteContext {
  params: Promise<{ id: string }>   // Next.js 15 — params is async
}

// ── GET /api/site-templates/[id] ───────────────────────────────
// Fetch a single template — the app deserializes template_json.
export async function GET(_req: NextRequest, { params }: RouteContext) {

  const { id }   = await params
  const supabase = await createClient()

  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { data, error } = await supabase
    .from('site_templates')
    .select('*')
    .eq('id', id)
    .maybeSingle()

  if (error) {
    console.error('[site-templates] fetch error:', error.message)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  if (!data) {
    return NextResponse.json({ error: 'Template not found' }, { status: 404 })
  }

  return NextResponse.json(
    { template: data as SiteTemplate },
    { status: 200 }
  )
}


// ── PATCH /api/site-templates/[id] ─────────────────────────────
// Update name, description, template_json, or active flag.
export async function PATCH(req: NextRequest, { params }: RouteContext) {

  const { id }   = await params
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

  // Build a partial update — only include provided fields
  const update: Record<string, unknown> = {}
  if (body.name         !== undefined) update.name          = body.name.trim()
  if (body.description  !== undefined) update.description   = body.description
  if (body.templateJson !== undefined) update.template_json = body.templateJson  // raw object
  if (body.isActive     !== undefined) update.is_active     = body.isActive

  if (Object.keys(update).length === 0) {
    return NextResponse.json(
      { error: 'No updatable fields provided' },
      { status: 400 }
    )
  }

  const { data, error } = await supabase
    .from('site_templates')
    .update(update)
    .eq('id', id)
    .select('id, name, description, template_json, is_active, created_at, updated_at, media_specs')
    .maybeSingle()

  if (error) {
    console.error('[site-templates] update error:', error.message)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  if (!data) {
    return NextResponse.json({ error: 'Template not found' }, { status: 404 })
  }

  return NextResponse.json(
    { template: data as SiteTemplate },
    { status: 200 }
  )
}


// ── DELETE /api/site-templates/[id] ────────────────────────────
export async function DELETE(_req: NextRequest, { params }: RouteContext) {

  const { id }   = await params
  const supabase = await createClient()

  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { error } = await supabase
    .from('site_templates')
    .delete()
    .eq('id', id)

  if (error) {
    console.error('[site-templates] delete error:', error.message)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ id, deleted: true }, { status: 200 })
}
