import { NextRequest, NextResponse } from 'next/server'
import { requireSuperAdmin } from '@/lib/auth/require-super-admin'
import { createClient } from '@/lib/supabase/server'
import type { CommentScheduleEntry } from '@/lib/types/comment-bank'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  try {
    await requireSuperAdmin()
  } catch (res) {
    return res as Response
  }

  const { searchParams } = new URL(req.url)
  const status = searchParams.get('status')
  const limit  = Number(searchParams.get('limit') ?? 200)

  const supabase = await createClient()
  const { data, error } = await supabase.rpc('get_comment_schedule', {
    p_status: status,
    p_limit:  limit,
  })

  if (error) {
    console.error('[api/comment-schedule] get_comment_schedule error:', error.message)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ entries: (data ?? []) as CommentScheduleEntry[] })
}
