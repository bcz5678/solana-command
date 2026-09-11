-- wallet_profiles: per-wallet "who this wallet pretends to be" — username,
-- bio, avatar, and two setup-status flags — so a wallet used for trading can
-- be given a real-looking, warmed-up Pump.fun identity instead of showing up
-- as a bare address. One row per wallet (wallet_id is UNIQUE); a wallet with
-- no row yet just has every profile field NULL/false — get_wallet_profiles()
-- starts from private.wallets and LEFT JOINs this, same shape as get_wallets()
-- LEFT JOINing wallet_owners/wallet_types/wallet_groups, so every wallet is
-- listed whether or not its profile has been touched.
--
-- pumpfun_setup: has this wallet's username/bio/avatar actually been pushed
-- live to Pump.fun (vs. just staged here). terminal_linked: has this
-- wallet's Pump.fun profile been linked on Trade.gg. Both are manually-set
-- status flags for now — no automated verification against either platform.
--
-- Run this in the Supabase SQL editor (Studio) to create/update. Not wired
-- into `supabase db push` — this repo has no migrations directory.

CREATE TABLE IF NOT EXISTS private.wallet_profiles (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  wallet_id        uuid NOT NULL UNIQUE REFERENCES private.wallets(id) ON DELETE CASCADE,
  username         text,
  bio              text,
  avatar_url       text,
  pumpfun_setup    boolean NOT NULL DEFAULT false,
  terminal_linked  boolean NOT NULL DEFAULT false,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

-- private schema — no RLS needed, same reasoning as trade_logs/comment_bank:
-- not PostgREST-exposed, only reachable through the SECURITY DEFINER RPCs below.


-- ── upsert_wallet_profile(): create or partially update ────────────
-- Any parameter left NULL leaves that field untouched on an existing row
-- (COALESCE against the current value) — same "partial update" convention as
-- rename_comment_bank(). On first insert for a wallet, an omitted boolean
-- flag defaults false and an omitted text field stays NULL.
DROP FUNCTION IF EXISTS public.upsert_wallet_profile(uuid,text,text,text,boolean,boolean);

CREATE OR REPLACE FUNCTION public.upsert_wallet_profile(
  p_wallet_id       uuid,
  p_username        text    DEFAULT NULL,
  p_bio             text    DEFAULT NULL,
  p_avatar_url      text    DEFAULT NULL,
  p_pumpfun_setup   boolean DEFAULT NULL,
  p_terminal_linked boolean DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = private, public
AS $$
DECLARE
  v_owner uuid;
  v_id    uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  SELECT user_id INTO v_owner FROM private.wallets WHERE id = p_wallet_id;
  IF v_owner IS NULL OR (v_owner != auth.uid() AND NOT (SELECT public.is_super_admin())) THEN
    RAISE EXCEPTION 'Wallet not found or not owned by caller';
  END IF;

  INSERT INTO private.wallet_profiles (wallet_id, username, bio, avatar_url, pumpfun_setup, terminal_linked)
  VALUES (p_wallet_id, p_username, p_bio, p_avatar_url, COALESCE(p_pumpfun_setup, false), COALESCE(p_terminal_linked, false))
  ON CONFLICT (wallet_id) DO UPDATE SET
    username        = COALESCE(p_username,        wallet_profiles.username),
    bio             = COALESCE(p_bio,              wallet_profiles.bio),
    avatar_url      = COALESCE(p_avatar_url,        wallet_profiles.avatar_url),
    pumpfun_setup   = COALESCE(p_pumpfun_setup,     wallet_profiles.pumpfun_setup),
    terminal_linked = COALESCE(p_terminal_linked,   wallet_profiles.terminal_linked),
    updated_at      = now()
  RETURNING id INTO v_id;

  RETURN jsonb_build_object('id', v_id);
END;
$$;

REVOKE ALL    ON FUNCTION public.upsert_wallet_profile(uuid,text,text,text,boolean,boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.upsert_wallet_profile(uuid,text,text,text,boolean,boolean) TO authenticated;


-- ── get_wallet_profiles(): every wallet, profile fields if set ─────
DROP FUNCTION IF EXISTS public.get_wallet_profiles(uuid);

CREATE OR REPLACE FUNCTION public.get_wallet_profiles(
  target_user_id uuid DEFAULT NULL
)
RETURNS TABLE (
  wallet_id         uuid,
  public_key        text,
  label             text,
  username          text,
  bio               text,
  avatar_url        text,
  pumpfun_setup     boolean,
  terminal_linked   boolean,
  profile_created_at timestamptz,
  profile_updated_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = private, public
AS $$
BEGIN
  IF (SELECT public.is_super_admin()) THEN
    RETURN QUERY
      SELECT
        w.id, w.public_key, w.label,
        wp.username, wp.bio, wp.avatar_url,
        COALESCE(wp.pumpfun_setup, false), COALESCE(wp.terminal_linked, false),
        wp.created_at, wp.updated_at
      FROM private.wallets w
      LEFT JOIN private.wallet_profiles wp ON wp.wallet_id = w.id
      WHERE (target_user_id IS NULL OR w.user_id = target_user_id)
      ORDER BY w.created_at DESC;

  ELSIF auth.uid() IS NOT NULL THEN
    RETURN QUERY
      SELECT
        w.id, w.public_key, w.label,
        wp.username, wp.bio, wp.avatar_url,
        COALESCE(wp.pumpfun_setup, false), COALESCE(wp.terminal_linked, false),
        wp.created_at, wp.updated_at
      FROM private.wallets w
      LEFT JOIN private.wallet_profiles wp ON wp.wallet_id = w.id
      WHERE w.user_id = auth.uid()   -- hard-scoped, not overridable
      ORDER BY w.created_at DESC;

  ELSE
    RETURN;
  END IF;
END;
$$;

REVOKE ALL    ON FUNCTION public.get_wallet_profiles(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_wallet_profiles(uuid) TO authenticated;


-- ── delete_wallet_profile(): back to "no profile set" ───────────────
DROP FUNCTION IF EXISTS public.delete_wallet_profile(uuid);

CREATE OR REPLACE FUNCTION public.delete_wallet_profile(p_wallet_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = private, public
AS $$
DECLARE
  v_owner uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  SELECT user_id INTO v_owner FROM private.wallets WHERE id = p_wallet_id;
  IF v_owner IS NULL OR (v_owner != auth.uid() AND NOT (SELECT public.is_super_admin())) THEN
    RAISE EXCEPTION 'Wallet not found or not owned by caller';
  END IF;

  DELETE FROM private.wallet_profiles WHERE wallet_id = p_wallet_id;
END;
$$;

REVOKE ALL    ON FUNCTION public.delete_wallet_profile(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.delete_wallet_profile(uuid) TO authenticated;
