import { createClient } from '@/lib/supabase/server'

export async function POST(req: Request) {
  let body: { email: string; password: string }
  try {
    body = await req.json()
  } catch {
    return new Response('Invalid JSON', { status: 400 })
  }

  const { email, password } = body
  if (!email || !password) return new Response('Missing credentials', { status: 400 })

  const supabase = await createClient()
  const { error } = await supabase.auth.signInWithPassword({ email, password })

  if (error) return Response.json({ error: error.message }, { status: 401 })

  // Session cookies are set automatically via the server client's setAll callback
  return Response.json({ ok: true })
}
