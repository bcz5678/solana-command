import { createClient }      from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { SupabaseClient }    from '@supabase/supabase-js'
import { redirect }          from 'next/navigation'

interface AdminContext {
  admin:  SupabaseClient
  userId: string
}

export async function requireSuperAdmin(): Promise<AdminContext> {
  const supabase = await createClient()

  // ── 1. Get authenticated user ────────────────────────────
  // getUser() validates the JWT server-side — more reliable than
  // getClaims() alone which only decodes without server verification
  const { data: { user }, error: userError } = await supabase.auth.getUser()

  if (userError || !user) {
    throw new Response('Unauthorized', { status: 401 })
  }

  const userId = user.id

  console.log(`userId: ${userId}`)

  // ── 2. Verify super admin via RPC ────────────────────────
  // is_super_admin() is a SECURITY DEFINER function in public schema —
  // it reads private.super_admins internally, bridging the schema gap.
  // Returns boolean — true only if JWT claim AND DB record both valid.
  const { data: isAdmin, error: adminError } = await supabase
    .rpc('is_super_admin')

  if (adminError) {
    console.error('is_super_admin() error:', adminError.message)
    throw new Response('Unauthorized', { status: 401 })
  }

  if (!isAdmin) {
    throw new Response('Forbidden', { status: 403 })
  }

  // ── 3. Return service-role client for privileged operations
  const admin = createAdminClient()

  return { admin, userId }
}

/**
 * Same check as requireSuperAdmin(), for a Server Component page instead of
 * a Route Handler — throwing a raw Response there doesn't render anything
 * useful, so this redirects instead.
 *
 * Path-based gating (an `/admin/*` matcher) isn't a substitute for this: this
 * app's middleware equivalent (proxy.ts at the repo root) is never actually
 * invoked by Next.js — it exports `proxy`/`config.matcher`, but Next.js only
 * runs a file named exactly `middleware.ts`. Every route "protected" by that
 * convention is currently wide open; this function is what actually gates a
 * page regardless of where that gap gets fixed.
 */
export async function requireSuperAdminPage(): Promise<{ userId: string }> {
  const supabase = await createClient()

  const { data: { user }, error: userError } = await supabase.auth.getUser()
  if (userError || !user) {
    redirect('/auth/login')
  }

  const { data: isAdmin, error: adminError } = await supabase.rpc('is_super_admin')
  if (adminError || !isAdmin) {
    redirect('/')
  }

  return { userId: user.id }
}