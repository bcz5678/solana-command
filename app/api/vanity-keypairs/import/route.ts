import { createClient } from '@/lib/supabase/server'

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

  const files = formData.getAll('files') as File[]
  if (files.length === 0) return new Response('No files provided', { status: 400 })

  const results: { filename: string; ok: boolean; message?: string }[] = []

  for (const file of files) {
    const contract_address = file.name.replace(/\.json$/i, '')
    try {
      const mint_keypair = JSON.parse(await file.text())

      const { error } = await supabase
        .from('vanity_keypairs')
        .insert([{ mint_keypair, contract_address, available: true }])

      if (error) throw new Error(error.message)
      results.push({ filename: file.name, ok: true })
    } catch (err) {
      results.push({
        filename: file.name,
        ok: false,
        message: err instanceof Error ? err.message : String(err),
      })
    }
  }

  return Response.json({ results })
}
