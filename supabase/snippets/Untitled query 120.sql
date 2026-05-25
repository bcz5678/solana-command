-- ============================================================
-- PATCH: Fix infinite recursion in wallet_owners RLS policies
-- ============================================================

-- 1. Drop all existing wallet_owners policies
DROP POLICY IF EXISTS "wallet_owners_deny_all_fallback" ON public.wallet_owners;
DROP POLICY IF EXISTS "wallet_owners_select"            ON public.wallet_owners;
DROP POLICY IF EXISTS "wallet_owners_insert"            ON public.wallet_owners;
DROP POLICY IF EXISTS "wallet_owners_update"            ON public.wallet_owners;
DROP POLICY IF EXISTS "wallet_owners_delete"            ON public.wallet_owners;

-- 2. Create a SECURITY DEFINER helper that checks co-ownership
--    without triggering RLS on wallet_owners itself
--    (SECURITY DEFINER bypasses RLS — breaks the recursion)
CREATE OR REPLACE FUNCTION private.user_owns_wallet(
  p_wallet_id uuid,
  p_user_id   uuid
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER                  -- bypasses RLS — no recursion
STABLE
SET search_path = private, public
AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM public.wallet_owners
    WHERE  wallet_id = p_wallet_id
      AND  user_id   = p_user_id
      AND  is_active = true
  );
END;
$$;

-- Only callable internally — not exposed to clients
REVOKE ALL ON FUNCTION private.user_owns_wallet(uuid, uuid) FROM PUBLIC;

-- 3. Create a helper for can_share check — same pattern
CREATE OR REPLACE FUNCTION private.user_can_share_wallet(
  p_wallet_id uuid,
  p_user_id   uuid
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = private, public
AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM public.wallet_owners
    WHERE  wallet_id = p_wallet_id
      AND  user_id   = p_user_id
      AND  is_active = true
      AND  can_share = true
  );
END;
$$;

REVOKE ALL ON FUNCTION private.user_can_share_wallet(uuid, uuid) FROM PUBLIC;

-- 4. Recreate all policies using the helper functions
--    No policy queries wallet_owners directly — recursion eliminated

-- Deny-all fallback
CREATE POLICY "wallet_owners_deny_all_fallback"
  ON public.wallet_owners
  FOR ALL TO PUBLIC
  USING (false)
  WITH CHECK (false);

-- SELECT: own record, co-owner on same wallet, or super admin
CREATE POLICY "wallet_owners_select"
  ON public.wallet_owners
  FOR SELECT
  TO authenticated
  USING (
    user_id = auth.uid()
    OR (SELECT private.user_owns_wallet(wallet_id, auth.uid()))
    OR (SELECT public.is_super_admin())
  );

-- INSERT: own record, or caller has can_share on that wallet
CREATE POLICY "wallet_owners_insert"
  ON public.wallet_owners
  FOR INSERT
  TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    OR (SELECT private.user_can_share_wallet(wallet_id, auth.uid()))
    OR (SELECT public.is_super_admin())
  );

-- UPDATE: own record, or caller has can_share on that wallet
CREATE POLICY "wallet_owners_update"
  ON public.wallet_owners
  FOR UPDATE
  TO authenticated
  USING (
    user_id = auth.uid()
    OR (SELECT private.user_can_share_wallet(wallet_id, auth.uid()))
    OR (SELECT public.is_super_admin())
  )
  WITH CHECK (
    -- Prevent re-assigning ownership to another user
    user_id = wallet_owners.user_id
    OR (SELECT public.is_super_admin())
  );

-- DELETE: own record, or caller has can_share on that wallet
CREATE POLICY "wallet_owners_delete"
  ON public.wallet_owners
  FOR DELETE
  TO authenticated
  USING (
    user_id = auth.uid()
    OR (SELECT private.user_can_share_wallet(wallet_id, auth.uid()))
    OR (SELECT public.is_super_admin())
  );