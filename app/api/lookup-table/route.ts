import { LookupTable } from '@/lib/types/lookup-table'
import { requireSuperAdmin } from '@/lib/auth/require-super-admin'
import { NextRequest, NextResponse } from 'next/server'

import { initializeQuickNodeSolana  } from '@/app/api/utils/helpers';

export const dynamic = 'force-dynamic'

type Res = NextResponse<{ data: LookupTable[] } | { error: string }>

export async function GET(_req: NextRequest): Promise<Res> {
  let userId: string
  let admin: Awaited<ReturnType<typeof requireSuperAdmin>>['admin']
  try {
    ;({ admin, userId } = await requireSuperAdmin())
  } catch (res) {
    return res as unknown as Res
  }


  const { data, error } = await admin.rpc('get_lookup_tables', { target_user_id: userId })
  
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ data: (data as LookupTable[] | null) ?? [] })
}
