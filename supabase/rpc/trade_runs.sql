-- trade_runs / trade_run_steps: durable progress record for the three
-- client-driven multi-step trade surfaces (staggered buy/sell wizard, bundle
-- trades wizard, launch builder). None of these move execution off the
-- browser — the tab that started a run is still the thing that fires each
-- trade — but every step it takes is now also written here, so a lost tab
-- (refresh/crash) still leaves a readable record instead of nothing at all,
-- and a second tab (the Trade Control Center) can request a pause/cancel
-- that the original tab picks up on its own poll of `control`.
--
-- Every RPC here is called by a logged-in browser tab through the SESSION
-- client (requireSuperAdmin() already passed) — unlike comment_schedule's
-- vault-signing callers, there's always a real auth.uid() — so these are
-- `authenticated`-granted with an internal is_super_admin()/auth.uid()-
-- ownership gate, same shape as get_comment_schedule(), not service-role-only.
--
-- Run this in the Supabase SQL editor (Studio). Not wired into `supabase db
-- push` — this repo has no migrations directory, schema changes are applied
-- by hand via Studio (same as comment_schedule.sql / comment_bank.sql).

-- ── Schema ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS private.trade_runs (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  surface       text NOT NULL
                  CHECK (surface IN ('staggered_buy','staggered_sell','bundle_buy','bundle_sell','launch_builder')),
  mint_address  text,
  label         text,
  status        text NOT NULL DEFAULT 'running'
                  CHECK (status IN ('running','paused','cancelled','done','error')),
  control       text NOT NULL DEFAULT 'none'
                  CHECK (control IN ('none','pause_requested','resume_requested','cancel_requested')),
  total_steps   integer,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

-- Control Center's list view + the "stalled — no update in >60s" check.
CREATE INDEX IF NOT EXISTS idx_trade_runs_status_updated
  ON private.trade_runs (status, updated_at);

CREATE TABLE IF NOT EXISTS private.trade_run_steps (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id      uuid NOT NULL REFERENCES private.trade_runs(id) ON DELETE CASCADE,
  -- wallet_id for staggered runs, `chunk-N` for bundle runs, the launch-
  -- builder node id (or `${nodeId}:${visitCount}` for a Loop/BranchReset
  -- re-visit) for launch_builder runs. Not a rigid int index — the UNIQUE
  -- constraint below is what makes upserts idempotent per surface's own
  -- notion of "one step."
  step_key    text NOT NULL,
  step_index  integer,  -- best-effort display order only, not a stable key
  wallet_id   uuid,     -- no FK — same convention as trade_logs/comment_schedule
  status      text NOT NULL
                CHECK (status IN ('pending','running','success','error','cancelled','skipped')),
  amount      text,     -- display string (lamports or ui amount), not typed numeric
  signature   text,
  error       text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (run_id, step_key)
);

CREATE INDEX IF NOT EXISTS idx_trade_run_steps_run
  ON private.trade_run_steps (run_id);

-- private schema — no RLS needed, same reasoning as comment_schedule/trade_logs:
-- not PostgREST-exposed, only reachable through the SECURITY DEFINER RPCs below.


-- ── create_trade_run(): called at the start of a run ─────────────────
DROP FUNCTION IF EXISTS public.create_trade_run(text,text,text,integer);

CREATE OR REPLACE FUNCTION public.create_trade_run(
  p_surface      text,
  p_mint_address text,
  p_label        text,
  p_total_steps  integer
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = private, public
AS $$
DECLARE
  v_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Unauthorized: requires an authenticated session';
  END IF;

  INSERT INTO private.trade_runs (user_id, surface, mint_address, label, total_steps)
  VALUES (auth.uid(), p_surface, p_mint_address, p_label, p_total_steps)
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

REVOKE ALL    ON FUNCTION public.create_trade_run(text,text,text,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_trade_run(text,text,text,integer) TO authenticated;


-- ── upsert_trade_run_step(): one call per step transition ────────────
DROP FUNCTION IF EXISTS public.upsert_trade_run_step(uuid,text,integer,uuid,text,text,text,text);

CREATE OR REPLACE FUNCTION public.upsert_trade_run_step(
  p_run_id     uuid,
  p_step_key   text,
  p_step_index integer,
  p_wallet_id  uuid,
  p_status     text,
  p_amount     text,
  p_signature  text,
  p_error      text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = private, public
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM private.trade_runs r
    WHERE r.id = p_run_id
      AND (public.is_super_admin() OR r.user_id = auth.uid())
  ) THEN
    RAISE EXCEPTION 'Unauthorized or run not found';
  END IF;

  INSERT INTO private.trade_run_steps (run_id, step_key, step_index, wallet_id, status, amount, signature, error)
  VALUES (p_run_id, p_step_key, p_step_index, p_wallet_id, p_status, p_amount, p_signature, p_error)
  ON CONFLICT (run_id, step_key) DO UPDATE SET
    step_index = EXCLUDED.step_index,
    wallet_id  = EXCLUDED.wallet_id,
    status     = EXCLUDED.status,
    amount     = EXCLUDED.amount,
    signature  = EXCLUDED.signature,
    error      = EXCLUDED.error,
    updated_at = now();

  UPDATE private.trade_runs SET updated_at = now() WHERE id = p_run_id;
END;
$$;

REVOKE ALL    ON FUNCTION public.upsert_trade_run_step(uuid,text,integer,uuid,text,text,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.upsert_trade_run_step(uuid,text,integer,uuid,text,text,text,text) TO authenticated;


-- ── update_trade_run_status(): finish (or re-flip, for bundle retries) ─
DROP FUNCTION IF EXISTS public.update_trade_run_status(uuid,text);

CREATE OR REPLACE FUNCTION public.update_trade_run_status(
  p_run_id uuid,
  p_status text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = private, public
AS $$
BEGIN
  UPDATE private.trade_runs
  SET status = p_status, updated_at = now()
  WHERE id = p_run_id
    AND (public.is_super_admin() OR user_id = auth.uid());

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Unauthorized or run not found';
  END IF;
END;
$$;

REVOKE ALL    ON FUNCTION public.update_trade_run_status(uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.update_trade_run_status(uuid,text) TO authenticated;


-- ── request_trade_run_control(): set by the Control Center, cleared by
-- the executing tab after it acts on the request ──────────────────────
DROP FUNCTION IF EXISTS public.request_trade_run_control(uuid,text);

CREATE OR REPLACE FUNCTION public.request_trade_run_control(
  p_run_id  uuid,
  p_control text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = private, public
AS $$
BEGIN
  UPDATE private.trade_runs
  SET control = p_control, updated_at = now()
  WHERE id = p_run_id
    AND (public.is_super_admin() OR user_id = auth.uid());

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Unauthorized or run not found';
  END IF;
END;
$$;

REVOKE ALL    ON FUNCTION public.request_trade_run_control(uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.request_trade_run_control(uuid,text) TO authenticated;


-- ── get_trade_runs(): Control Center's list view ──────────────────────
DROP FUNCTION IF EXISTS public.get_trade_runs(text,integer);

CREATE OR REPLACE FUNCTION public.get_trade_runs(
  p_status text    DEFAULT NULL,
  p_limit  integer DEFAULT 100
)
RETURNS TABLE (
  id            uuid,
  surface       text,
  mint_address  text,
  label         text,
  status        text,
  control       text,
  total_steps   integer,
  created_at    timestamptz,
  updated_at    timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = private, public
AS $$
BEGIN
  IF (SELECT public.is_super_admin()) THEN
    RETURN QUERY
      SELECT r.id, r.surface, r.mint_address, r.label, r.status, r.control, r.total_steps, r.created_at, r.updated_at
      FROM private.trade_runs r
      WHERE (p_status IS NULL OR r.status = p_status)
      ORDER BY r.updated_at DESC
      LIMIT p_limit;

  ELSIF auth.uid() IS NOT NULL THEN
    RETURN QUERY
      SELECT r.id, r.surface, r.mint_address, r.label, r.status, r.control, r.total_steps, r.created_at, r.updated_at
      FROM private.trade_runs r
      WHERE r.user_id = auth.uid()
        AND (p_status IS NULL OR r.status = p_status)
      ORDER BY r.updated_at DESC
      LIMIT p_limit;

  ELSE
    RETURN;
  END IF;
END;
$$;

REVOKE ALL    ON FUNCTION public.get_trade_runs(text,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_trade_runs(text,integer) TO authenticated;


-- ── get_trade_run(): single row — used by the executing tab's own
-- poll of its run's `control` field ────────────────────────────────────
DROP FUNCTION IF EXISTS public.get_trade_run(uuid);

CREATE OR REPLACE FUNCTION public.get_trade_run(
  p_run_id uuid
)
RETURNS TABLE (
  id            uuid,
  surface       text,
  mint_address  text,
  label         text,
  status        text,
  control       text,
  total_steps   integer,
  created_at    timestamptz,
  updated_at    timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = private, public
AS $$
BEGIN
  RETURN QUERY
    SELECT r.id, r.surface, r.mint_address, r.label, r.status, r.control, r.total_steps, r.created_at, r.updated_at
    FROM private.trade_runs r
    WHERE r.id = p_run_id
      AND (public.is_super_admin() OR r.user_id = auth.uid());
END;
$$;

REVOKE ALL    ON FUNCTION public.get_trade_run(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_trade_run(uuid) TO authenticated;


-- ── get_trade_run_steps(): Control Center's expand-a-row view ─────────
DROP FUNCTION IF EXISTS public.get_trade_run_steps(uuid);

CREATE OR REPLACE FUNCTION public.get_trade_run_steps(
  p_run_id uuid
)
RETURNS TABLE (
  id          uuid,
  step_key    text,
  step_index  integer,
  wallet_id   uuid,
  status      text,
  amount      text,
  signature   text,
  error       text,
  created_at  timestamptz,
  updated_at  timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = private, public
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM private.trade_runs r
    WHERE r.id = p_run_id
      AND (public.is_super_admin() OR r.user_id = auth.uid())
  ) THEN
    RETURN;
  END IF;

  RETURN QUERY
    SELECT s.id, s.step_key, s.step_index, s.wallet_id, s.status, s.amount, s.signature, s.error, s.created_at, s.updated_at
    FROM private.trade_run_steps s
    WHERE s.run_id = p_run_id
    ORDER BY s.step_index NULLS LAST, s.created_at ASC;
END;
$$;

REVOKE ALL    ON FUNCTION public.get_trade_run_steps(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_trade_run_steps(uuid) TO authenticated;
