import { NextRequest, NextResponse } from 'next/server'
import { requireSuperAdmin } from '@/lib/auth/require-super-admin'
import { createClient } from '@/lib/supabase/server'
import { postPumpFunCommentForWallet } from '@/lib/pumpfun/comment-bot'

export const dynamic    = 'force-dynamic'
export const maxDuration = 30

interface CommentBody {
  walletId?:      string
  mintAddress?:   string
  text?:          string
  commentBankId?: string
}

export async function POST(req: NextRequest) {
  try {
    await requireSuperAdmin()
  } catch (res) {
    return res as Response
  }

  let body: CommentBody
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const { walletId, mintAddress, text, commentBankId } = body
  if (!walletId || !mintAddress || !text?.trim()) {
    return NextResponse.json(
      { error: 'walletId, mintAddress, and text are required' },
      { status: 400 },
    )
  }

  const result = await postPumpFunCommentForWallet(walletId, mintAddress, text.trim())

  if (!result.success) {
    console.error(`[api/pumpfun/comment] wallet=${walletId} mint=${mintAddress} failed:`, result.error, result.raw)
    return NextResponse.json(
      { error: result.error ?? 'Comment post failed', raw: result.raw },
      { status: 502 },
    )
  }

  // Retire the bank entry so the next pull skips it — best-effort, a failed
  // bump must never turn a successful callout post into an error response.
  if (commentBankId) {
    const supabase = await createClient()
    const { error } = await supabase.rpc('mark_comment_bank_used', { p_id: commentBankId })
    if (error) {
      console.error(`[api/pumpfun/comment] mark_comment_bank_used failed id=${commentBankId}:`, error.message)
    }
  }

  return NextResponse.json({ success: true, raw: result.raw }, { status: 200 })
}
