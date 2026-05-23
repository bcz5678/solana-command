import { requireSuperAdmin }  from '@/app/api/require-super-admin'
import { importVanityBatch }  from '@/lib/vault/vanity-batch'

export async function POST(req: Request) {
  let admin, userId
  try {
    ({ admin, userId } = await requireSuperAdmin())
  } catch (e) {
    return e as Response
  }

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
    try {
      const parsed = JSON.parse(await file.text())

      // Each file is a single Solana keypair: a raw 64-element number[]
      if (!Array.isArray(parsed) || parsed.length !== 64 || !parsed.every(n => typeof n === 'number')) {
        throw new Error('File must contain a single 64-byte secret key array')
      }

      const summary = await importVanityBatch(admin, userId, [parsed], file.name)

      const { imported, skipped_suffix, skipped_duplicate, failed } = summary
      results.push({
        filename: file.name,
        ok: imported > 0,
        message: imported > 0
          ? undefined
          : `skipped_suffix=${skipped_suffix} skipped_duplicate=${skipped_duplicate} failed=${failed}`
      })
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
