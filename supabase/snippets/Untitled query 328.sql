-- private helper functions called from RLS policies
-- Must be executable by authenticated — SECURITY DEFINER handles the rest
GRANT EXECUTE ON FUNCTION private.user_owns_wallet(uuid, uuid)     TO authenticated;
GRANT EXECUTE ON FUNCTION private.user_can_share_wallet(uuid, uuid) TO authenticated;

-- Verify grants applied
SELECT
  p.proname       AS function_name,
  r.rolname       AS grantee,
  'EXECUTE'       AS privilege
FROM   pg_proc         p
JOIN   pg_namespace    n  ON n.oid  = p.pronamespace
JOIN   pg_roles        r  ON true
WHERE  n.nspname   = 'private'
  AND  p.proname   IN ('user_owns_wallet', 'user_can_share_wallet')
  AND  has_function_privilege(r.rolname, p.oid, 'EXECUTE')
  AND  r.rolname   IN ('authenticated', 'anon', 'postgres');

-- Expected:
-- user_owns_wallet      | authenticated | EXECUTE
-- user_owns_wallet      | postgres      | EXECUTE
-- user_can_share_wallet | authenticated | EXECUTE
-- user_can_share_wallet | postgres      | EXECUTE
-- anon should NOT appear in results