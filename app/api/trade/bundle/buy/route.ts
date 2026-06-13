// app/api/lookup-tables/create/route.ts

import { NextRequest, NextResponse }   from 'next/server'
import { requireSuperAdmin }           from '@/lib/auth/require-super-admin'
import { createClient }                from '@/lib/supabase/server'
import { getWalletKeypairById }        from '@/lib/wallet/keypair'
import {
  PublicKey,
  Keypair,
  AddressLookupTableProgram,
  TransactionMessage,
  VersionedTransaction,
  SendTransactionError
} from '@solana/web3.js'
import { initializeQuickNodeSolana } from '../../../utils/helpers'
import BN from 'bn.js'
import { BundleBuyBody, BuyTokenBody } from '@/lib/types/trades'





export async function POST(req: NextRequest) {
  try {
    await requireSuperAdmin()
  } catch (res) {
    return res as Response
  }

  const supabase = await createClient()


  // ── 2. Parse + validate ────────────────────────────────────
  let body: BundleBuyBody
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }



  
  return NextResponse.json({
  
  }, { status: 201 })
}