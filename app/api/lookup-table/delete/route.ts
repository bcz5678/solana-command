import { LookupTable } from '@/lib/types/lookup-table'
import { requireSuperAdmin } from '@/lib/auth/require-super-admin'
import { NextRequest, NextResponse } from 'next/server'

type Res = NextResponse<{ ok: true } | { error: string }>

export async function DELETE(req: NextRequest): Promise<Res> {
  let admin: Awaited<ReturnType<typeof requireSuperAdmin>>['admin']
  try {
    ;({ admin } = await requireSuperAdmin())
  } catch (res) {
    return res as unknown as Res
  }

  let body: Pick<LookupTable, 'id'>
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  if (!body.id) {
    return NextResponse.json({ error: 'id is required' }, { status: 400 })
  }

  const { error } = await admin.rpc('delete_lookup_table', { p_id: body.id })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ ok: true })
}
