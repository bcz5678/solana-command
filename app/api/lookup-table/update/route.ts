import { LookupTable } from '@/lib/types/lookup-table'
import { requireSuperAdmin } from '@/lib/auth/require-super-admin'
import { NextRequest, NextResponse } from 'next/server'

type UpdateBody =
  Pick<LookupTable, 'id'> &
  Partial<Pick<LookupTable, 'display_name' | 'description' | 'address_count' | 'status'>>

type Res = NextResponse<{ ok: true } | { error: string }>

export async function PATCH(req: NextRequest): Promise<Res> {
  let admin: Awaited<ReturnType<typeof requireSuperAdmin>>['admin']
  try {
    ;({ admin } = await requireSuperAdmin())
  } catch (res) {
    return res as unknown as Res
  }

  let body: UpdateBody
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const { id, display_name, description, address_count, status } = body

  if (!id) {
    return NextResponse.json({ error: 'id is required' }, { status: 400 })
  }

  const { error } = await admin.rpc('update_lookup_table', {
    p_id:            id,
    p_display_name:  display_name  ?? null,
    p_description:   description   ?? null,
    p_address_count: address_count ?? null,
    p_status:        status        ?? null,
  })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ ok: true })
}
