// app/api/wallets/recovery-blob/route.ts

import { NextRequest, NextResponse } from 'next/server'
import { createClient }              from '@/lib/supabase/server'



interface RecoveryBlob {
    encrypted_seed: string
    iv:             string
    salt:           string
    kdf_iterations: number      
    enc_algorithm:  string
}



export async function POST(req: NextRequest) {

  const supabase = await createClient()

  // Auth — user must be authenticated
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { walletId } = await req.json()

  if (!walletId) {
    return NextResponse.json({ error: 'Missing walletId' }, { status: 400 })
  }

  // get_wallet_recovery() validates ownership internally:
  //   WHERE wallet_id = p_wallet_id
  //   AND (user_id = auth.uid() OR is_super_admin())
  // Returns ONLY the encrypted blob — server cannot decrypt it
  const { data, error } = await supabase
    .rpc('get_wallet_recovery', { p_wallet_id: walletId })
    .returns<RecoveryBlob[]>()
    .single()

  if (error || !data) {
    return NextResponse.json(
      { error: 'Recovery data not found' },
      { status: 404 }
    )
  }



  // Return ciphertext + KDF params — server never sees the plaintext
  return NextResponse.json({
    encrypted_seed: data.encrypted_seed,
    iv:             data.iv,
    salt:           data.salt,
    kdf_iterations: data.kdf_iterations
  })
}