// app/api/tokens/explorer/route.ts

import { NextRequest, NextResponse } from 'next/server'
import { createClient }              from '@/lib/supabase/server'
import { requireSuperAdmin }         from '@/lib/auth/require-super-admin'
import { TokenMint }                 from '@/lib/types/token';

export async function GET(req: NextRequest) {

  // ── 1. Auth — super admin only ─────────────────────────────
  try {
    await requireSuperAdmin()
  } catch (res) {
    return res as Response
  }

  // ── 2. User JWT client — required for is_super_admin() ────
  const supabase = await createClient()

  // ── 3. Parse query params ──────────────────────────────────
  const { searchParams } = new URL(req.url)

  const targetUserId = searchParams.get('userId')    ?? null
  const status       = searchParams.get('status')    ?? 'draft'
  const chain        = searchParams.get('chain')     ?? null
  const tokenType    = searchParams.get('tokenType') ?? null
  const limit        = parseInt(searchParams.get('limit')  ?? '50')
  const offset       = parseInt(searchParams.get('offset') ?? '0')

  // ── 4. Validate status param ───────────────────────────────
  const validStatuses = ['draft', 'ready', 'launching', 'launched', 'failed', 'all']
  if (!validStatuses.includes(status)) {
    return NextResponse.json(
      {
        error:          `Invalid status: ${status}`,
        valid_statuses: validStatuses
      },
      { status: 400 }
    )
  }

  // ── 5. Fetch via get_token_mints() ─────────────────────────
  // get_token_mints() scopes automatically:
  //   is_super_admin() = true  → all tokens (or filtered by targetUserId)
  //   is_super_admin() = false → own tokens only
  const { data: tokens, error: rpcError } = await supabase
    .rpc('get_token_mints', {
      target_user_id: targetUserId
    }) as { data: TokenMint[] | null; error: { message: string } | null }

  if (rpcError) {
    console.error('[tokens/explorer] get_token_mints error:', rpcError.message)
    return NextResponse.json(
      { error: rpcError.message },
      { status: 500 }
    )
  }

  if (!tokens) {
    return NextResponse.json(
      { tokens: [], total: 0, filtered: 0 },
      { status: 200 }
    )
  }

  // ── 6. Filter client-side ──────────────────────────────────
  // get_token_mints() doesn't accept filter params yet —
  // filter here until the SQL function is extended
  let filtered = [...tokens]

  // Filter by launch_status
  if (status !== 'all') {
    filtered = filtered.filter(t =>
      (t as TokenMint & { launch_status: string }).launch_status === status
    )
  }

  // Filter by chain
  if (chain) {
    filtered = filtered.filter(t =>
      (t as TokenMint & { chain: string }).chain?.toLowerCase() === chain.toLowerCase()
    )
  }

  // Filter by token_type
  if (tokenType) {
    filtered = filtered.filter(t => t.token_type === tokenType)
  }

  // ── 7. Paginate ────────────────────────────────────────────
  const total      = filtered.length
  const paginated  = filtered.slice(offset, offset + limit)

  return NextResponse.json({
    tokens:   paginated,
    total,
    limit,
    offset,
    hasMore:  offset + limit < total,
    filters: {
      status,
      chain:     chain     ?? 'all',
      tokenType: tokenType ?? 'all',
      userId:    targetUserId ?? 'all'
    }
  }, { status: 200 })
}