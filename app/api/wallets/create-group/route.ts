// app/api/wallet-groups/create/route.ts

import { NextRequest, NextResponse } from 'next/server'
import { createClient }              from '@/lib/supabase/server'

interface CreateGroupBody {
  name:        string
  description?: string | null
  color?:      string | null
  icon?:       string | null
  isDefault?:  boolean
}

export async function POST(req: NextRequest) {

  // ── 1. Auth — uses createClient() NOT admin ───────────────
  // create_wallet_group() resolves auth.uid() internally
  // so the user JWT must flow through
  const supabase = await createClient()

  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // ── 2. Parse body ──────────────────────────────────────────
  let body: CreateGroupBody
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const { name, description = null, color = null, icon = null, isDefault = false } = body

  if (!name || !name.trim()) {
    return NextResponse.json(
      { error: 'Group name is required' },
      { status: 400 }
    )
  }

  // ── 3. Call create_wallet_group() ─────────────────────────
  // Parameter names must match the SQL function exactly:
  //   p_name, p_description, p_color, p_icon, p_is_default
  const { data, error: rpcError } = await supabase
    .rpc('create_wallet_group', {
      p_name:        name.trim(),
      p_description: description,
      p_color:       color,
      p_icon:        icon,
      p_is_default:  isDefault
    })

  if (rpcError) {
    console.error('[create-wallet-group] RPC error:', rpcError.message)
    return NextResponse.json(
      { error: rpcError.message },
      { status: 500 }
    )
  }

  return NextResponse.json(
    { groupId: data.group_id },
    { status: 201 }
  )
}