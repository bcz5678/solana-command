import { createClient }    from '@/lib/supabase/server'
import { generateVanityMint } from '@/modules/vanityMint'

export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  const supabase = await createClient()

  const { data: authData } = await supabase.auth.getClaims()
  if (!authData?.claims) return new Response('Unauthorized', { status: 401 })

  let formData: FormData
  try {
    formData = await req.formData()
  } catch {
    return new Response('Invalid form data', { status: 400 })
  }

  const creatorWallet   = formData.get('creatorWallet')   as string | null
  const name            = formData.get('name')            as string | null
  const symbol          = formData.get('symbol')          as string | null
  const description     = formData.get('description')     as string | null
  const logoFile        = formData.get('logo')            as File   | null
  const websiteUrl      = formData.get('websiteUrl')      as string | null
  const twitterUrl      = formData.get('twitterUrl')      as string | null
  const telegramHandle  = formData.get('telegramHandle')  as string | null

  if (!creatorWallet || !name || !symbol || !description || !logoFile) {
    return new Response('Missing required fields', { status: 400 })
  }

  // ── 1. Try to claim a prebuilt vanity keypair ──────────────────────────────
  let mintSecretKey: string
  let contractAddress:  string
  let vanityId: number | null = null

  const { data: available } = await supabase
    .from('vanity_keypairs')
    .select('id, mint_secret_key, contract_address')
    .eq('available', true)
    .limit(1)
    .single()

  if (available) {
    mintSecretKey   = available.mint_secret_key
    contractAddress = available.contract_address
    vanityId        = available.id
  } else {
    // ── 2. No prebuilt — grind one server-side ─────────────────────────────
    const { keypair } = await generateVanityMint({ suffix: 'pump' })
    mintSecretKey   = JSON.stringify(Array.from(keypair.secretKey))
    contractAddress = keypair.publicKey.toBase58()
    keypair.secretKey.fill(0)
  }

  // ── 3. Upload logo ─────────────────────────────────────────────────────────
  const ext = logoFile.name.split('.').pop()
  const logoPath = `public/${symbol}_${contractAddress.slice(0, 7)}_logo.${ext}`

  const { data: imgData, error: uploadError } = await supabase.storage
    .from('token-media')
    .upload(logoPath, logoFile)

  if (uploadError) {
    return Response.json({ error: 'Logo upload failed: ' + uploadError.message }, { status: 500 })
  }

  // ── 4. Insert token record ─────────────────────────────────────────────────
  const { error: insertError } = await supabase
    .from('tokens')
    .insert([{
      dev_wallet_id:    creatorWallet,
      name,
      symbol,
      description,
      mint_secret_key:  mintSecretKey,
      contract_address: contractAddress,
      logo_url:         imgData?.path,
      website_url:      websiteUrl,
      twitter_url:      twitterUrl,
      telegram_handle:  telegramHandle,
    }])

  if (insertError) {
    return Response.json({ error: 'Token insert failed: ' + insertError.message }, { status: 500 })
  }

  // ── 5. Mark vanity row consumed ────────────────────────────────────────────
  if (vanityId !== null) {
    await supabase
      .from('vanity_keypairs')
      .update({ available: false })
      .eq('id', vanityId)
  }

  return Response.json({ contractAddress, logoUrl: imgData?.path })
}
