import { NextRequest, NextResponse } from 'next/server'
import { requireSuperAdmin } from '@/lib/auth/require-super-admin'
import { createClient } from '@/lib/supabase/server'
import type { CommentBankEntry } from '@/lib/types/comment-bank'

export const dynamic = 'force-dynamic'

// Entries within one bank — see /api/comment-banks for the bank entities themselves.
export async function GET(req: NextRequest) {
  try {
    await requireSuperAdmin()
  } catch (res) {
    return res as Response
  }

  const { searchParams } = new URL(req.url)
  const bankId = searchParams.get('bankId')
  const limit  = Number(searchParams.get('limit') ?? 500)

  if (!bankId) {
    return NextResponse.json({ error: 'bankId is required' }, { status: 400 })
  }

  const supabase = await createClient()
  const { data, error } = await supabase.rpc('get_comment_bank', {
    p_bank_id:     bankId,
    p_active_only: true,
    p_limit:       limit,
  })

  if (error) {
    console.error('[api/comment-bank] get_comment_bank error:', error.message)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ entries: (data ?? []) as CommentBankEntry[] })
}

export async function POST(req: NextRequest) {
  try {
    await requireSuperAdmin()
  } catch (res) {
    return res as Response
  }

  let body: { bankId?: string; texts?: string[]; source?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const texts = (body.texts ?? []).map((t) => t.trim()).filter(Boolean)
  if (!body.bankId) {
    return NextResponse.json({ error: 'bankId is required' }, { status: 400 })
  }
  if (texts.length === 0) {
    return NextResponse.json({ error: 'texts must be a non-empty array' }, { status: 400 })
  }

  const supabase = await createClient()
  const { data, error } = await supabase.rpc('add_comment_bank_entries', {
    p_bank_id: body.bankId,
    p_texts:   texts,
    p_source:  body.source ?? 'manual',
  })

  if (error) {
    console.error('[api/comment-bank] add_comment_bank_entries error:', error.message)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ success: true, ...(data as { inserted: number }) })
}

export async function DELETE(req: NextRequest) {
  try {
    await requireSuperAdmin()
  } catch (res) {
    return res as Response
  }

  const { searchParams } = new URL(req.url)
  const id = searchParams.get('id')
  if (!id) {
    return NextResponse.json({ error: 'id is required' }, { status: 400 })
  }

  const supabase = await createClient()
  const { error } = await supabase.rpc('delete_comment_bank_entry', { p_id: id })

  if (error) {
    console.error('[api/comment-bank] delete_comment_bank_entry error:', error.message)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ success: true })
}
