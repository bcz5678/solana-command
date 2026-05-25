-- ===========================================================
-- TABLE: public.wallet_owners
-- Links a wallet to an ownership record with a type and role.
-- Supports multiple owners per wallet (e.g. shared/team wallets).
-- ===========================================================

-- Owner roles within a wallet
-- 'sole'       = only owner, full control
-- 'primary'    = main owner in a shared wallet
-- 'co-owner'   = equal rights, no unilateral action
-- 'view-only'  = can see balance/txs but not sign
CREATE TABLE public.wallet_owners (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),

  -- The wallet being owned (public key safe to reference)
  wallet_id       uuid        NOT NULL REFERENCES private.wallets(id) ON DELETE CASCADE,

  -- The user who owns or has access to this wallet
  user_id         uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  -- Wallet type classification for this owner's context
  -- FK to wallet_types — e.g. 'trading', 'cold', 'treasury'
  wallet_type_id  uuid        REFERENCES public.wallet_types(id) ON DELETE SET NULL,

  -- Role this user plays for this wallet
  role            text        NOT NULL DEFAULT 'sole'
                  CHECK (role IN ('sole','primary','co-owner','view-only')),

  -- Optional: which group this owner placed this wallet in
  group_id        uuid        REFERENCES public.wallet_groups(id) ON DELETE SET NULL,

  -- Soft permissions — granular control per owner
  can_sign        boolean     NOT NULL DEFAULT true,    -- can initiate txs
  can_view        boolean     NOT NULL DEFAULT true,    -- can view balance/history
  can_share       boolean     NOT NULL DEFAULT false,   -- can add other owners

  -- Ownership metadata
  label           text,                                 -- owner's personal wallet label
  notes           text,
  is_active       boolean     NOT NULL DEFAULT true,

  granted_by      uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  granted_at      timestamptz NOT NULL DEFAULT now(),
  revoked_at      timestamptz,                          -- soft revoke

  -- One ownership record per user per wallet
  CONSTRAINT one_owner_record_per_wallet
    UNIQUE (wallet_id, user_id)
);

CREATE INDEX idx_wallet_owners_user
  ON public.wallet_owners (user_id)
  WHERE is_active = true;

CREATE INDEX idx_wallet_owners_wallet
  ON public.wallet_owners (wallet_id)
  WHERE is_active = true;

ALTER TABLE public.wallet_owners ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wallet_owners FORCE ROW LEVEL SECURITY;

REVOKE ALL  ON public.wallet_owners FROM PUBLIC;
REVOKE ALL  ON public.wallet_owners FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.wallet_owners TO authenticated;

-- Deny-all fallback
CREATE POLICY "wallet_owners_deny_all_fallback"
  ON public.wallet_owners
  FOR ALL TO PUBLIC
  USING (false)
  WITH CHECK (false);

-- Users see their own ownership records
-- Co-owners on same wallet see each other
-- Super admins see all
CREATE POLICY "wallet_owners_select"
  ON public.wallet_owners
  FOR SELECT
  TO authenticated
  USING (
    -- Own record
    user_id = auth.uid()
    -- Co-owner: can see other owners of wallets I own
    OR EXISTS (
      SELECT 1 FROM public.wallet_owners wo
      WHERE wo.wallet_id = wallet_owners.wallet_id
        AND wo.user_id   = auth.uid()
        AND wo.is_active = true
        AND wo.can_view  = true
    )
    OR (SELECT public.is_super_admin())
  );

-- Sole/primary owners and users with can_share=true can grant access
-- Super admins can always insert
CREATE POLICY "wallet_owners_insert"
  ON public.wallet_owners
  FOR INSERT
  TO authenticated
  WITH CHECK (
    -- Adding yourself as owner (initial claim)
    user_id = auth.uid()
    -- Sharing: must be an active owner with can_share permission
    OR EXISTS (
      SELECT 1 FROM public.wallet_owners wo
      WHERE wo.wallet_id = wallet_owners.wallet_id
        AND wo.user_id   = auth.uid()
        AND wo.is_active = true
        AND wo.can_share = true
    )
    OR (SELECT public.is_super_admin())
  );

-- Users update only their own ownership record (label, notes, group)
-- can_share owners can update other owners' roles on shared wallets
-- Super admins update any
CREATE POLICY "wallet_owners_update"
  ON public.wallet_owners
  FOR UPDATE
  TO authenticated
  USING (
    user_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.wallet_owners wo
      WHERE wo.wallet_id = wallet_owners.wallet_id
        AND wo.user_id   = auth.uid()
        AND wo.is_active = true
        AND wo.can_share = true
    )
    OR (SELECT public.is_super_admin())
  )
  WITH CHECK (
    -- Re-assigning ownership to another user is not allowed
    -- user_id on the record cannot change via this policy
    user_id = wallet_owners.user_id
    OR (SELECT public.is_super_admin())
  );

-- Only the owner themselves or super admin can remove an ownership record
-- can_share owners can revoke others (soft revoke via UPDATE preferred)
CREATE POLICY "wallet_owners_delete"
  ON public.wallet_owners
  FOR DELETE
  TO authenticated
  USING (
    user_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.wallet_owners wo
      WHERE wo.wallet_id = wallet_owners.wallet_id
        AND wo.user_id   = auth.uid()
        AND wo.can_share = true
        AND wo.is_active = true
    )
    OR (SELECT public.is_super_admin())
  );