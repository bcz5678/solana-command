// supabase/functions/solana-trade/index.ts

import { serve }           from 'https://deno.land/std/http/server.ts'
import { createClient }    from '@supabase/supabase-js'
import { signAndSendTransfer } from './transaction.js'

serve(async (req: Request) => {

  // 1. Authenticate scheduler/caller
  const token = req.headers.get('Authorization')?.replace('Bearer ', '')
  if (token !== Deno.env.get('BOT_SCHEDULER_SECRET')) {
    return new Response('Unauthorized', { status: 401 })
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  )

  try {
    const { walletId, toPublicKey, amountSOL } = await req.json()

    // 2. Sign + send — secrets handled internally
    const result = await signAndSendTransfer({
      walletId,
      toPublicKey,
      amountSOL
    })

    // 3. Log tx result only — no keys, no secrets
    await supabase.from('private.trade_logs').insert({
      wallet_id:    result.walletId,
      tx_signature: result.signature,     // ✅ safe — public tx hash
      slot:         result.slot,
      amount_sol:   amountSOL,
      to_address:   toPublicKey,          // ✅ safe — public key
      status:       'confirmed',
      executed_at:  new Date().toISOString()
    })

    return new Response(
      JSON.stringify({ signature: result.signature }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    )

  } catch (err) {
    await supabase.from('private.trade_logs').insert({
      status:      'error',
      error:       err instanceof Error ? err.message : 'Unknown error',
      executed_at: new Date().toISOString()
    })

    return new Response('Internal error', { status: 500 })
  }
})