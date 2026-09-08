-- pnl_baseline: per-user "reset the PnL panel" control. Realized/unrealized
-- PnL (get_wallet_pnl_summary.sql, get_wallet_trade_fills.sql) is computed
-- purely from private.trade_logs BUY/SELL fills — it has no idea about
-- wallet-to-wallet TOKEN transfers (many-to-many, many-to-one, consolidate,
-- etc — none of those are trades). A wallet that bought a position and then
-- had those tokens moved to another wallet off-book still shows the
-- original BUY as an open (or badly-priced) position here, which can make
-- the panel report a loss that never actually happened. Properly
-- attributing cost basis across a token transfer would need transfer
-- quantities folded into the FIFO walk in app/api/wallet/pnl/route.ts — a
-- much bigger project. This is the pragmatic fix instead: let the user draw
-- a line and only count PnL from trades after it, so old muddied history
-- stops distorting today's number.
--
-- Run this in the Supabase SQL editor (Studio) to create/update. Not wired
-- into `supabase db push` — this repo has no migrations directory.

CREATE TABLE IF NOT EXISTS private.pnl_baseline (
  user_id    uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  since      timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- private schema — no RLS needed, same reasoning as trade_logs: not
-- PostgREST-exposed, only reachable through the SECURITY DEFINER RPCs below.


-- ── set_pnl_baseline(): reset-now or a custom start point ─────────
-- p_since NULL means "right now" (the Reset button's case). target_user_id
-- lets a super admin set the baseline for a wallet owner other than
-- themselves; a non-admin can only ever set their own (same pattern as
-- get_wallet_pnl_summary's target_user_id).
DROP FUNCTION IF EXISTS public.set_pnl_baseline(timestamptz, uuid);

CREATE OR REPLACE FUNCTION public.set_pnl_baseline(
  p_since        timestamptz DEFAULT NULL,
  target_user_id uuid        DEFAULT NULL
)
RETURNS timestamptz
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = private, public
AS $$
DECLARE
  v_user_id uuid;
  v_since   timestamptz := COALESCE(p_since, now());
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  IF target_user_id IS NOT NULL AND target_user_id != auth.uid() THEN
    IF NOT (SELECT public.is_super_admin()) THEN
      RAISE EXCEPTION 'Unauthorized: only a super admin may set another user''s PnL baseline';
    END IF;
    v_user_id := target_user_id;
  ELSE
    v_user_id := auth.uid();
  END IF;

  INSERT INTO private.pnl_baseline (user_id, since)
  VALUES (v_user_id, v_since)
  ON CONFLICT (user_id) DO UPDATE SET since = EXCLUDED.since, created_at = now();

  RETURN v_since;
END;
$$;

REVOKE ALL    ON FUNCTION public.set_pnl_baseline(timestamptz, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_pnl_baseline(timestamptz, uuid) TO authenticated;


-- ── clear_pnl_baseline(): back to full history ─────────────────────
DROP FUNCTION IF EXISTS public.clear_pnl_baseline(uuid);

CREATE OR REPLACE FUNCTION public.clear_pnl_baseline(
  target_user_id uuid DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = private, public
AS $$
DECLARE
  v_user_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  IF target_user_id IS NOT NULL AND target_user_id != auth.uid() THEN
    IF NOT (SELECT public.is_super_admin()) THEN
      RAISE EXCEPTION 'Unauthorized: only a super admin may clear another user''s PnL baseline';
    END IF;
    v_user_id := target_user_id;
  ELSE
    v_user_id := auth.uid();
  END IF;

  DELETE FROM private.pnl_baseline WHERE user_id = v_user_id;
END;
$$;

REVOKE ALL    ON FUNCTION public.clear_pnl_baseline(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.clear_pnl_baseline(uuid) TO authenticated;


-- ── get_pnl_baseline(): current start point, if any ────────────────
DROP FUNCTION IF EXISTS public.get_pnl_baseline(uuid);

CREATE OR REPLACE FUNCTION public.get_pnl_baseline(
  target_user_id uuid DEFAULT NULL
)
RETURNS timestamptz
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = private, public
AS $$
DECLARE
  v_user_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN NULL;
  END IF;

  IF target_user_id IS NOT NULL AND target_user_id != auth.uid() THEN
    IF NOT (SELECT public.is_super_admin()) THEN
      RETURN NULL;
    END IF;
    v_user_id := target_user_id;
  ELSE
    v_user_id := auth.uid();
  END IF;

  RETURN (SELECT since FROM private.pnl_baseline WHERE user_id = v_user_id);
END;
$$;

REVOKE ALL    ON FUNCTION public.get_pnl_baseline(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_pnl_baseline(uuid) TO authenticated;
