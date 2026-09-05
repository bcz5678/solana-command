import { NextRequest, NextResponse } from 'next/server'
import { requireSuperAdmin } from '@/lib/auth/require-super-admin'
import { createClient } from '@/lib/supabase/server'
import type { CommentBank } from '@/lib/types/comment-bank'

export const dynamic = 'force-dynamic'

// Bank entities — see /api/comment-bank for the entries within one bank.
export async function GET(req: NextRequest) {
  try {
    await requireSuperAdmin()
  } catch (res) {
    return res as Response
  }

  const { searchParams } = new URL(req.url)
  const mintAddress = searchParams.get('mintAddress')

  const supabase = await createClient()
  const { data, error } = await supabase.rpc('list_comment_banks', {
    p_mint_address: mintAddress,
  })

  if (error) {
    console.error('[api/comment-banks] list_comment_banks error:', error.message)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ banks: (data ?? []) as CommentBank[] })
}

export async function POST(req: NextRequest) {
  try {
    await requireSuperAdmin()
  } catch (res) {
    return res as Response
  }

  let body: { name?: string; description?: string; mintAddress?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  if (!body.name?.trim()) {
    return NextResponse.json({ error: 'name is required' }, { status: 400 })
  }

  const supabase = await createClient()
  const { data, error } = await supabase.rpc('create_comment_bank', {
    p_name:         body.name.trim(),
    p_description:  body.description ?? null,
    p_mint_address: body.mintAddress ?? null,
  })

  if (error) {
    console.error('[api/comment-banks] create_comment_bank error:', error.message)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ success: true, ...(data as { id: string }) })
}
