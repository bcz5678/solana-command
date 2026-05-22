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

  const origin = req.headers.get('origin') ?? process.env.NEXT_PUBLIC_SITE_URL ?? ''

  const supabase = await createClient()
  const { error } = await supabase.auth.signUp({
    email,
    password,
    options: { emailRedirectTo: `${origin}/protected` },
  })

  if (error) return Response.json({ error: error.message }, { status: 400 })

  return Response.json({ ok: true })
}
