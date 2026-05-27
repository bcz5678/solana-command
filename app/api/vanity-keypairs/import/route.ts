// app/api/vanity-keypairs/import/route.ts

import { NextRequest, NextResponse }  from 'next/server'
import { requireSuperAdmin }          from '@/lib/auth/require-super-admin'
import { importVanityBatch }          from '@/lib/vault/vanity-batch'

export async function POST(req: NextRequest) {

  // userId is already verified by requireSuperAdmin —
  // no need to call getUser() again anywhere downstream
  let admin, userId
  try {
    ({ admin, userId } = await requireSuperAdmin())
  } catch (res) {
    return res as Response
  }

  const formData = await req.formData()
  const files    = formData.getAll('files') as File[]

  if (files.length === 0) {
    return NextResponse.json(
      { error: 'No files provided' },
      { status: 400 }
    )
  }

  try {
    const result = await importVanityBatch(
      admin,       // service-role client
      files,
      userId       // ← pass verified userId directly
    )


    console.log(`result: ${result.results[0].error}`);

    return NextResponse.json(result)
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 500 }
    )
  }
}