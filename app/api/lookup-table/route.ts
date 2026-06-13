// app/api/lookup-tables/route.ts

import { NextRequest, NextResponse } from 'next/server'
import { createClient }              from '@/lib/supabase/server'
import { requireSuperAdmin }         from '@/lib/auth/require-super-admin'
import { LookupTable }               from '@/lib/types/lookup-table'

export async function GET(req: NextRequest) {

  // ── 1. Auth — super admin only ─────────────────────────────
  // Uses createClient() for the RPC since get_lookup_tables()
  // checks is_super_admin() / auth.uid() — needs the user JWT
  try {
    await requireSuperAdmin()
  } catch (res) {
    return res as Response
  }

  const supabase = await createClient()

  // ── 2. Optional filters ────────────────────────────────────
  const { searchParams } = new URL(req.url)
  const targetUserId     = searchParams.get('userId') ?? null
  const status           = searchParams.get('status') ?? null   // active|frozen|deactivated
  const chain            = searchParams.get('chain')  ?? null

  // ── 3. Fetch via security definer function ────────────────
  // get_lookup_tables() scopes automatically:
  //   super admin → all (or by targetUserId)
  //   user        → own only
const { data: tablesRaw, error: rpcError } = await supabase
  .rpc('get_lookup_tables', {
    target_user_id: targetUserId
  })



  if (rpcError) {
    console.error('[lookup-tables] error:', rpcError.message)
    return NextResponse.json({ error: rpcError.message }, { status: 500 })
  }

  // Cast through unknown — the RPC returns a row set (LookupTable[])
  const tables = (tablesRaw ?? []) as unknown as LookupTable[]

  // ── 4. Optional client-side filtering ─────────────────────
  let filtered = tables ?? []

  if (status) {
    console.log(`lookup-table/route -> in filtered by status: ${status}`)
    filtered = filtered.filter(t => t.status === status)
  }

  if (chain) {
    filtered = filtered.filter(t => t.chain.toLowerCase() === chain.toLowerCase())
  }


    console.log(`lookup-table/route -> tables: ${tables}`)

  return NextResponse.json({
    tables:  filtered,
    total:   filtered.length,
    filters: {
      status: status ?? 'all',
      chain:  chain  ?? 'all',
      userId: targetUserId ?? 'all'
    }
  }, { status: 200 })
}