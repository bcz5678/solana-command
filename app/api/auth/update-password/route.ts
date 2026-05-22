import { createClient } from '@/lib/supabase/server'

export async function POST(req: Request) {
  let body: { password: string }
  try {
    body = await req.json()
  } catch {
    return new Response('Invalid JSON', { status: 400 })
  }

  const { password } = body
  if (!password) return new Response('Missing password', { status: 400 })

  const supabase = await createClient()
  const { error } = await supabase.auth.updateUser({ password })

  if (error) return Response.json({ error: error.message }, { status: 400 })

  return Response.json({ ok: true })
}
