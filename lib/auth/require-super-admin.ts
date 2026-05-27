import { createClient }      from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { SupabaseClient }    from '@supabase/supabase-js'

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