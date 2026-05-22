import { createClient }      from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { SupabaseClient }    from '@supabase/supabase-js'

interface AdminContext {
  admin:  SupabaseClient
  userId: string
}

/**
 * Verifies the request is from a super_admin via JWT claims,
 * then returns a service-role admin client and the caller's user ID.
 *
 * Throws a Response (403/401) if the check fails — API routes
 * can catch and return it directly.
 *
 * Usage:
 *   const { admin, userId } = await requireSuperAdmin()
 */
export async function requireSuperAdmin(): Promise<AdminContext> {
  const supabase = await createClient()
  const { data } = await supabase.auth.getClaims()

  const claims = data?.claims
  if (!claims) throw new Response('Unauthorized', { status: 401 })

  if (claims.app_metadata?.role !== 'super_admin') {
    throw new Response('Forbidden', { status: 403 })
  }

  return {
    admin:  createAdminClient(),
    userId: claims.sub
  }
}
