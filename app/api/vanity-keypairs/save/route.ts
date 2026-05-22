import { createClient } from '@/lib/supabase/server'

export async function POST(req: Request) {
  const supabase = await createClient()

  const { data: authData } = await supabase.auth.getClaims()
  if (!authData?.claims) return new Response('Unauthorized', { status: 401 })

  let body: { mintKeypair: number[]; contractAddress: string }
  try {
    body = await req.json()
  } catch {
    return new Response('Invalid JSON', { status: 400 })
  }

  const { mintKeypair, contractAddress } = body

  if (!Array.isArray(mintKeypair) || mintKeypair.length !== 64) {
    return new Response('mintKeypair must be a 64-byte array', { status: 400 })
  }
  if (!contractAddress?.toLowerCase().endsWith('pump')) {
    return new Response('Contract address must end with pump', { status: 400 })
  }

  const { error } = await supabase
    .from('vanity_keypairs')
    .insert([{ mint_keypair: mintKeypair, contract_address: contractAddress, available: true }])

  if (error) return Response.json({ error: error.message }, { status: 500 })

  return Response.json({ ok: true })
}
