import { NextRequest, NextResponse } from 'next/server'
import { requireSuperAdmin } from '@/lib/auth/require-super-admin'
import { createClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

type Params = { params: Promise<{ id: string }> }

export async function PATCH(req: NextRequest, { params }: Params) {
  try {
    await requireSuperAdmin()
  } catch (res) {
    return res as Response
  }

  const { id } = await params

  let body: { name?: string; description?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  if (!body.name?.trim()) {
    return NextResponse.json({ error: 'name is required' }, { status: 400 })
  }

  const supabase = await createClient()
  const { error } = await supabase.rpc('rename_comment_bank', {
    p_id:          id,
    p_name:        body.name.trim(),
    p_description: body.description ?? null,
  })

  if (error) {
    console.error('[api/comment-banks/:id] rename_comment_bank error:', error.message)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ success: true })
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  try {
    await requireSuperAdmin()
  } catch (res) {
    return res as Response
  }

  const { id } = await params

  const supabase = await createClient()
  const { error } = await supabase.rpc('delete_comment_bank', { p_id: id })

  if (error) {
    console.error('[api/comment-banks/:id] delete_comment_bank error:', error.message)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ success: true })
}
