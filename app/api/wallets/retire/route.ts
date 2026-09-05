import { NextRequest, NextResponse } from 'next/server'
import { requireSuperAdmin } from '@/lib/auth/require-super-admin'
import { createClient } from '@/lib/supabase/server'
import { handleError, initializeQuickNodeSolana, parseAndValidateAddress } from '@/app/api/utils/helpers'
import { retireWallet } from '@/lib/wallet/retire'

export const dynamic    = 'force-dynamic'
export const maxDuration = 90

interface RetireBody {
  walletId?:          string
  destinationAddress?: string
  feePayerWalletId?:  string
}

export async function POST(req: NextRequest) {
  try {
    await requireSuperAdmin()
  } catch (res) {
    return res as Response
  }

  let body: RetireBody
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const { walletId, destinationAddress, feePayerWalletId } = body
  if (!walletId || !destinationAddress) {
    return NextResponse.json({ error: 'walletId and destinationAddress are required' }, { status: 400 })
  }

  try {
    const destination = await parseAndValidateAddress(destinationAddress)
    const connection = initializeQuickNodeSolana().connection
    const supabase = await createClient()

    const result = await retireWallet(connection, supabase, walletId, destination, feePayerWalletId)

    if (!result.success) {
      return NextResponse.json(result, { status: 400 })
    }

    return NextResponse.json(result)
  } catch (err) {
    return handleError(err)
  }
}
