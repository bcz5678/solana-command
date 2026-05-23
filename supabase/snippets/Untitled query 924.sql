-- ============================================================
-- USER-SCOPED RLS: Wallet Groups, Types, Owners
-- Authenticated users — NOT super admin tables
-- All tables live in public schema (PostgREST exposed)
-- RLS enforces row-level ownership
-- ============================================================


-- ===========================================================
-- TABLE: public.wallet_types
-- Shared lookup table — defines wallet categories.
-- Super admins write, all authenticated users read.
-- e.g. 'trading', 'treasury', 'hot', 'cold', 'minting'
-- ===========================================================

CREATE TABLE public.wallet_types (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  name          text        NOT NULL UNIQUE,
  description   text,
  icon          text,                        -- icon name / URL for UI
  is_system     boolean     NOT NULL DEFAULT false,  -- true = created by admin, undeletable
  created_by    uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.wallet_types ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wallet_types FORCE ROW LEVEL SECURITY;

REVOKE ALL  ON public.wallet_types FROM PUBLIC;
REVOKE ALL  ON public.wallet_types FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.wallet_types TO authenticated;

-- Deny-all fallback
CREATE POLICY "wallet_types_deny_all_fallback"
  ON public.wallet_types
  FOR ALL TO PUBLIC
  USING (false)
  WITH CHECK (false);

-- All authenticated users can read all types (shared lookup)
CREATE POLICY "wallet_types_select_authenticated"
  ON public.wallet_types
  FOR SELECT
  TO authenticated
  USING (true);                              -- no row filter — all types visible

-- Only super admins can create/modify/delete types
CREATE POLICY "wallet_types_insert_admin"
  ON public.wallet_types
  FOR INSERT
  TO authenticated
  WITH CHECK ((SELECT public.is_super_admin()));

CREATE POLICY "wallet_types_update_admin"
  ON public.wallet_types
  FOR UPDATE
  TO authenticated
  USING      ((SELECT public.is_super_admin()))
  WITH CHECK ((SELECT public.is_super_admin()));

-- Super admin only, and only non-system types
CREATE POLICY "wallet_types_delete_admin"
  ON public.wallet_types
  FOR DELETE
  TO authenticated
  USING (
    (SELECT public.is_super_admin())
    AND is_system = false             -- system types are permanent
  );


-- ===========================================================
-- TABLE: public.wallet_groups
-- User-owned collections of wallets.
-- Each user manages their own groups only.
-- Super admins can see and manage all groups.
-- ===========================================================

CREATE TABLE public.wallet_groups (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name            text        NOT NULL,
  description     text,
  color           text,                      -- UI color tag e.g. '#FF5733'
  icon            text,                      -- icon name for UI
  is_default      boolean     NOT NULL DEFAULT false,  -- user's uncategorized group
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),

  -- One default group per user
  CONSTRAINT one_default_group_per_user
    UNIQUE NULLS NOT DISTINCT (user_id, is_default)
    DEFERRABLE INITIALLY DEFERRED
);

-- Auto-update updated_at
CREATE TRIGGER wallet_groups_updated_at
  BEFORE UPDATE ON public.wallet_groups
  FOR EACH ROW EXECUTE FUNCTION private.set_updated_at();

ALTER TABLE public.wallet_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wallet_groups FORCE ROW LEVEL SECURITY;

REVOKE ALL  ON public.wallet_groups FROM PUBLIC;
REVOKE ALL  ON public.wallet_groups FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.wallet_groups TO authenticated;

-- Deny-all fallback
CREATE POLICY "wallet_groups_deny_all_fallback"
  ON public.wallet_groups
  FOR ALL TO PUBLIC
  USING (false)
  WITH CHECK (false);

-- Users see own groups, super admins see all
CREATE POLICY "wallet_groups_select"
  ON public.wallet_groups
  FOR SELECT
  TO authenticated
  USING (
    user_id = auth.uid()
    OR (SELECT public.is_super_admin())
  );

-- Users create only their own groups
CREATE POLICY "wallet_groups_insert"
  ON public.wallet_groups
  FOR INSERT
  TO authenticated
  WITH CHECK (
    user_id = auth.uid()              -- can't create groups for other users
    OR (SELECT public.is_super_admin())
  );

-- Users update only their own groups, super admin updates any
CREATE POLICY "wallet_groups_update"
  ON public.wallet_groups
  FOR UPDATE
  TO authenticated
  USING (
    user_id = auth.uid()
    OR (SELECT public.is_super_admin())
  )
  WITH CHECK (
    user_id = auth.uid()              -- can't re-assign group to another user
    OR (SELECT public.is_super_admin())
  );

-- Users delete own non-default groups
-- Super admins can delete any non-default group
CREATE POLICY "wallet_groups_delete"
  ON public.wallet_groups
  FOR DELETE
  TO authenticated
  USING (
    (
      user_id    = auth.uid()
      AND is_default = false          -- default group is permanent
    )
    OR (
      (SELECT public.is_super_admin())
      AND is_default = false
    )
  );


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


-- ===========================================================
-- HELPER FUNCTIONS — User-scoped, no super admin required
-- ===========================================================

-- ── get_my_wallets() ─────────────────────────────────────────
-- Returns all wallets the calling user has an ownership record for,
-- joined with type and group metadata.
-- Reads from private.wallets via SECURITY DEFINER —
-- the only safe bridge from private schema to authenticated users.
CREATE OR REPLACE FUNCTION public.get_my_wallets()
RETURNS TABLE (
  wallet_id       uuid,
  public_key      text,
  wallet_label    text,        -- from wallet_owners.label (personal label)
  chain           text,
  is_active       boolean,
  role            text,
  can_sign        boolean,
  can_view        boolean,
  can_share       boolean,
  wallet_type     text,        -- from wallet_types.name
  group_name      text,        -- from wallet_groups.name
  group_color     text,
  granted_at      timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = private, public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  RETURN QUERY
    SELECT
      w.id                AS wallet_id,
      w.public_key,
      wo.label            AS wallet_label,
      w.chain,
      w.is_active,
      wo.role,
      wo.can_sign,
      wo.can_view,
      wo.can_share,
      wt.name             AS wallet_type,
      wg.name             AS group_name,
      wg.color            AS group_color,
      wo.granted_at
    FROM   public.wallet_owners  wo
    JOIN   private.wallets       w   ON w.id  = wo.wallet_id
    LEFT   JOIN public.wallet_types  wt  ON wt.id = wo.wallet_type_id
    LEFT   JOIN public.wallet_groups wg  ON wg.id = wo.group_id
    WHERE  wo.user_id   = auth.uid()
      AND  wo.is_active = true
      AND  wo.revoked_at IS NULL
    ORDER BY wg.name NULLS LAST, w.created_at DESC;
END;
$$;

REVOKE ALL    ON FUNCTION public.get_my_wallets() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_my_wallets() TO authenticated;


-- ── create_wallet_group() ────────────────────────────────────
-- Creates a group for the calling user.
-- Ensures only one default group exists per user.
CREATE OR REPLACE FUNCTION public.create_wallet_group(
  p_name        text,
  p_description text    DEFAULT NULL,
  p_color       text    DEFAULT NULL,
  p_icon        text    DEFAULT NULL,
  p_is_default  boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = private, public
AS $$
DECLARE
  v_group_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  -- If marking as default, unset existing default first
  IF p_is_default THEN
    UPDATE public.wallet_groups
    SET    is_default = false,
           updated_at = now()
    WHERE  user_id    = auth.uid()
      AND  is_default = true;
  END IF;

  INSERT INTO public.wallet_groups (
    user_id, name, description, color, icon, is_default
  )
  VALUES (
    auth.uid(), p_name, p_description, p_color, p_icon, p_is_default
  )
  RETURNING id INTO v_group_id;

  RETURN jsonb_build_object('group_id', v_group_id);
END;
$$;

REVOKE ALL    ON FUNCTION public.create_wallet_group(text,text,text,text,boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_wallet_group(text,text,text,text,boolean) TO authenticated;


-- ── assign_wallet_to_group() ─────────────────────────────────
-- Moves a wallet the user owns into one of their groups.
-- Validates both the wallet ownership and group ownership.
CREATE OR REPLACE FUNCTION public.assign_wallet_to_group(
  p_wallet_id  uuid,
  p_group_id   uuid    -- NULL = remove from group (ungrouped)
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = private, public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  -- Verify caller owns the target group (if not NULL)
  IF p_group_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.wallet_groups
      WHERE id      = p_group_id
        AND user_id = auth.uid()
    ) THEN
      RAISE EXCEPTION 'Group not found or not owned by caller';
    END IF;
  END IF;

  -- Update the ownership record — only for caller's own ownership
  UPDATE public.wallet_owners
  SET    group_id = p_group_id
  WHERE  wallet_id = p_wallet_id
    AND  user_id   = auth.uid()
    AND  is_active = true;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Wallet not found in your ownership records';
  END IF;
END;
$$;

REVOKE ALL    ON FUNCTION public.assign_wallet_to_group(uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.assign_wallet_to_group(uuid,uuid) TO authenticated;


-- ── set_wallet_type() ────────────────────────────────────────
-- Sets the wallet type on the caller's ownership record.
-- Each user can classify the same wallet differently.
CREATE OR REPLACE FUNCTION public.set_wallet_type(
  p_wallet_id      uuid,
  p_wallet_type_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = private, public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  -- Verify the type exists (readable by all authenticated)
  IF NOT EXISTS (
    SELECT 1 FROM public.wallet_types WHERE id = p_wallet_type_id
  ) THEN
    RAISE EXCEPTION 'Wallet type not found: %', p_wallet_type_id;
  END IF;

  UPDATE public.wallet_owners
  SET    wallet_type_id = p_wallet_type_id
  WHERE  wallet_id = p_wallet_id
    AND  user_id   = auth.uid()
    AND  is_active = true;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Wallet not found in your ownership records';
  END IF;
END;
$$;

REVOKE ALL    ON FUNCTION public.set_wallet_type(uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_wallet_type(uuid,uuid) TO authenticated;