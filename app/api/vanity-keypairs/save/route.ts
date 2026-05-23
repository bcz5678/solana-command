import { requireSuperAdmin }        from '@/app/api/require-super-admin'
import { addVanityKeypairToVault }  from '@/lib/vault/vanity'

export async function POST(req: Request) {
  let admin, userId
  try {
    ({ admin, userId } = await requireSuperAdmin())
  } catch (e) {
    return e as Response
  }

  let body: { mintKeypair: number[] }
  try {
    body = await req.json()
  } catch {
    return new Response('Invalid JSON', { status: 400 })
  }

  const { mintKeypair } = body

  if (!Array.isArray(mintKeypair) || mintKeypair.length !== 64) {
    return new Response('mintKeypair must be a 64-byte array', { status: 400 })
  }

  try {
    const result = await addVanityKeypairToVault(admin, userId, mintKeypair)
    return Response.json(result)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return Response.json({ error: message }, { status: 500 })
  }
}
