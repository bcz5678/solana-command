import { NextRequest, NextResponse } from 'next/server'
import { requireSuperAdmin } from '@/lib/auth/require-super-admin'
import { lookupOwnCalloutIdForWallet, postPumpFunCalloutReplyForWallet } from '@/lib/pumpfun/comment-bot'

export const dynamic     = 'force-dynamic'
export const maxDuration = 30

// GET — resolve a wallet's own existing calloutId for a mint, so the UI can
// find "my callout" without the caller needing pump.fun's raw UUID.
export async function GET(req: NextRequest) {
  try {
    await requireSuperAdmin()
  } catch (res) {
    return res as Response
  }

  const { searchParams } = new URL(req.url)
  const walletId    = searchParams.get('walletId')
  const mintAddress = searchParams.get('mintAddress')
  if (!walletId || !mintAddress) {
    return NextResponse.json({ error: 'walletId and mintAddress are required' }, { status: 400 })
  }

  const result = await lookupOwnCalloutIdForWallet(walletId, mintAddress)
  if (result.error) {
    return NextResponse.json({ error: result.error }, { status: 502 })
  }
  return NextResponse.json({ calloutId: result.calloutId, thesis: result.thesis ?? null })
}

interface ReplyBody {
  walletId?:  string
  calloutId?: string
  text?:      string
}

// POST — post a threaded reply under an existing callout.
export async function POST(req: NextRequest) {
  try {
    await requireSuperAdmin()
  } catch (res) {
    return res as Response
  }

  let body: ReplyBody
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const { walletId, calloutId, text } = body
  if (!walletId || !calloutId || !text?.trim()) {
    return NextResponse.json(
      { error: 'walletId, calloutId, and text are required' },
      { status: 400 },
    )
  }

  const result = await postPumpFunCalloutReplyForWallet(walletId, calloutId, text.trim())

  if (!result.success) {
    console.error(`[api/pumpfun/callout-reply] wallet=${walletId} calloutId=${calloutId} failed:`, result.error, result.raw)
    return NextResponse.json(
      { error: result.error ?? 'Reply post failed', raw: result.raw },
      { status: 502 },
    )
  }

  return NextResponse.json({ success: true, raw: result.raw }, { status: 200 })
}
