-- comment_schedule: durable queue for "comment N minutes after this wallet
-- bought" — the DB row is the source of truth for when/what to post, not an
-- in-process timer, so a server restart doesn't silently drop pending work.
-- A background sweep loop (lib/pumpfun/comment-scheduler.ts, booted via
-- instrumentation.ts) polls claim_due_comment_schedule() on an interval.
--
-- Every RPC here is service_role-only, same gating as log_trade.sql — these
-- are triggered by the bundle/buy and staggered/buy routes (which already
-- hold the admin client for vault access) and by the background sweep loop,
-- never directly by an end user. get_comment_schedule() is the one exception
-- (auth.uid()/is_super_admin()-aware, same shape as get_comment_bank()) since
-- that one backs a status panel a logged-in user views in the browser.
--
-- Run this in the Supabase SQL editor (Studio). Not wired into `supabase db
-- push` — this repo has no migrations directory, schema changes are applied
-- by hand via Studio (same as log_trade.sql / comment_bank.sql).

-- ── Schema ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS private.comment_schedule (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  wallet_id       uuid NOT NULL,
  mint_address    text NOT NULL,
  status          text NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending','processing','posted','skipped','failed')),
  scheduled_for   timestamptz NOT NULL,
  claimed_at      timestamptz,
  posted_at       timestamptz,
  comment_bank_id uuid,
  callout_id      text,
  attempts        integer NOT NULL DEFAULT 0,
  last_error      text,
  source          text,  -- 'bundle_buy' | 'staggered_buy' | ... — which flow enqueued this
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- Sweep loop's hot path: due pending (+ stale processing) rows, oldest first.
CREATE INDEX IF NOT EXISTS idx_comment_schedule_due
  ON private.comment_schedule (status, scheduled_for);

-- One active/succeeded schedule per wallet+mint — pump.fun itself only
-- allows one callout per wallet per coin, so a second enqueue for the same
-- pair while one is pending/processing/posted would just waste an attempt.
-- Skipped/failed rows don't block a fresh retry-enqueue.
CREATE UNIQUE INDEX IF NOT EXISTS idx_comment_schedule_one_active_per_wallet_mint
  ON private.comment_schedule (wallet_id, mint_address)
  WHERE status IN ('pending','processing','posted');

-- private schema — no RLS needed, same reasoning as trade_logs/comment_bank:
-- not PostgREST-exposed, only reachable through the SECURITY DEFINER RPCs below.


-- ── enqueue_comment_schedule(): called right after a successful buy ─
DROP FUNCTION IF EXISTS public.enqueue_comment_schedule(uuid,uuid,text,timestamptz,text);

CREATE OR REPLACE FUNCTION public.enqueue_comment_schedule(
  p_user_id       uuid,
  p_wallet_id     uuid,
  p_mint_address  text,
  p_scheduled_for timestamptz,
  p_source        text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = private, public
AS $$
DECLARE
  v_id uuid;
BEGIN
  IF auth.role() != 'service_role' THEN
    RAISE EXCEPTION 'Unauthorized: requires service_role';
  END IF;

  INSERT INTO private.comment_schedule (user_id, wallet_id, mint_address, scheduled_for, source)
  VALUES (p_user_id, p_wallet_id, p_mint_address, p_scheduled_for, p_source)
  ON CONFLICT DO NOTHING
  RETURNING id INTO v_id;

  RETURN jsonb_build_object('id', v_id, 'enqueued', v_id IS NOT NULL);
END;
$$;

REVOKE ALL ON FUNCTION public.enqueue_comment_schedule(uuid,uuid,text,timestamptz,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.enqueue_comment_schedule(uuid,uuid,text,timestamptz,text) FROM authenticated;
REVOKE ALL ON FUNCTION public.enqueue_comment_schedule(uuid,uuid,text,timestamptz,text) FROM anon;


-- ── claim_due_comment_schedule(): sweep loop's poll query ───────────
-- Claims (status -> 'processing') and returns due rows atomically —
-- FOR UPDATE SKIP LOCKED so this is safe even if called concurrently.
-- Also reclaims rows stuck in 'processing' for >10min (a crash mid-post
-- shouldn't strand a row forever).
DROP FUNCTION IF EXISTS public.claim_due_comment_schedule(integer);

CREATE OR REPLACE FUNCTION public.claim_due_comment_schedule(
  p_limit integer DEFAULT 20
)
RETURNS TABLE (
  id           uuid,
  user_id      uuid,
  wallet_id    uuid,
  mint_address text,
  attempts     integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = private, public
AS $$
BEGIN
  IF auth.role() != 'service_role' THEN
    RAISE EXCEPTION 'Unauthorized: requires service_role';
  END IF;

  RETURN QUERY
    UPDATE private.comment_schedule cs
    SET status = 'processing', claimed_at = now()
    WHERE cs.id IN (
      SELECT c.id FROM private.comment_schedule c
      WHERE c.scheduled_for <= now()
        AND (
          c.status = 'pending'
          OR (c.status = 'processing' AND c.claimed_at < now() - interval '10 minutes')
        )
      ORDER BY c.scheduled_for ASC
      LIMIT p_limit
      FOR UPDATE SKIP LOCKED
    )
    RETURNING cs.id, cs.user_id, cs.wallet_id, cs.mint_address, cs.attempts;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_due_comment_schedule(integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.claim_due_comment_schedule(integer) FROM authenticated;
REVOKE ALL ON FUNCTION public.claim_due_comment_schedule(integer) FROM anon;


-- ── claim_comment_bank_entry(): atomically pick + bump usage ────────
-- Used by the sweep loop at fire time instead of get_comment_bank() +
-- mark_comment_bank_used() as two round trips — one atomic claim avoids a
-- race if the scheduler ever processes more than one due row concurrently.
DROP FUNCTION IF EXISTS public.claim_comment_bank_entry(uuid);

CREATE OR REPLACE FUNCTION public.claim_comment_bank_entry(
  p_user_id uuid
)
RETURNS TABLE (id uuid, text text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = private, public
AS $$
BEGIN
  IF auth.role() != 'service_role' THEN
    RAISE EXCEPTION 'Unauthorized: requires service_role';
  END IF;

  RETURN QUERY
    UPDATE private.comment_bank cb
    SET used_count = cb.used_count + 1, last_used_at = now()
    WHERE cb.id = (
      SELECT c.id FROM private.comment_bank c
      WHERE c.user_id = p_user_id AND c.is_active
      ORDER BY c.used_count ASC, c.last_used_at ASC NULLS FIRST, c.created_at ASC
      LIMIT 1
      FOR UPDATE SKIP LOCKED
    )
    RETURNING cb.id, cb.text;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_comment_bank_entry(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.claim_comment_bank_entry(uuid) FROM authenticated;
REVOKE ALL ON FUNCTION public.claim_comment_bank_entry(uuid) FROM anon;


-- ── mark_comment_schedule_posted() ───────────────────────────────────
DROP FUNCTION IF EXISTS public.mark_comment_schedule_posted(uuid,uuid,text);

CREATE OR REPLACE FUNCTION public.mark_comment_schedule_posted(
  p_id              uuid,
  p_comment_bank_id uuid,
  p_callout_id      text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = private, public
AS $$
BEGIN
  IF auth.role() != 'service_role' THEN
    RAISE EXCEPTION 'Unauthorized: requires service_role';
  END IF;

  UPDATE private.comment_schedule
  SET status          = 'posted',
      posted_at       = now(),
      comment_bank_id = p_comment_bank_id,
      callout_id      = p_callout_id
  WHERE id = p_id;
END;
$$;

REVOKE ALL ON FUNCTION public.mark_comment_schedule_posted(uuid,uuid,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.mark_comment_schedule_posted(uuid,uuid,text) FROM authenticated;
REVOKE ALL ON FUNCTION public.mark_comment_schedule_posted(uuid,uuid,text) FROM anon;


-- ── mark_comment_schedule_skipped() ──────────────────────────────────
-- Not a failure — e.g. the wallet no longer holds the token by fire time.
DROP FUNCTION IF EXISTS public.mark_comment_schedule_skipped(uuid,text);

CREATE OR REPLACE FUNCTION public.mark_comment_schedule_skipped(
  p_id     uuid,
  p_reason text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = private, public
AS $$
BEGIN
  IF auth.role() != 'service_role' THEN
    RAISE EXCEPTION 'Unauthorized: requires service_role';
  END IF;

  UPDATE private.comment_schedule
  SET status = 'skipped', last_error = p_reason
  WHERE id = p_id;
END;
$$;

REVOKE ALL ON FUNCTION public.mark_comment_schedule_skipped(uuid,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.mark_comment_schedule_skipped(uuid,text) FROM authenticated;
REVOKE ALL ON FUNCTION public.mark_comment_schedule_skipped(uuid,text) FROM anon;


-- ── mark_comment_schedule_failed() ───────────────────────────────────
-- No auto-retry in v1 — attempts is tracked for visibility only.
DROP FUNCTION IF EXISTS public.mark_comment_schedule_failed(uuid,text);

CREATE OR REPLACE FUNCTION public.mark_comment_schedule_failed(
  p_id    uuid,
  p_error text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = private, public
AS $$
BEGIN
  IF auth.role() != 'service_role' THEN
    RAISE EXCEPTION 'Unauthorized: requires service_role';
  END IF;

  UPDATE private.comment_schedule
  SET status     = 'failed',
      attempts   = attempts + 1,
      last_error = p_error
  WHERE id = p_id;
END;
$$;

REVOKE ALL ON FUNCTION public.mark_comment_schedule_failed(uuid,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.mark_comment_schedule_failed(uuid,text) FROM authenticated;
REVOKE ALL ON FUNCTION public.mark_comment_schedule_failed(uuid,text) FROM anon;


-- ── get_comment_schedule(): status panel read ────────────────────────
DROP FUNCTION IF EXISTS public.get_comment_schedule(text,integer);

CREATE OR REPLACE FUNCTION public.get_comment_schedule(
  p_status text    DEFAULT NULL,
  p_limit  integer DEFAULT 200
)
RETURNS TABLE (
  id              uuid,
  wallet_id       uuid,
  mint_address    text,
  status          text,
  scheduled_for   timestamptz,
  posted_at       timestamptz,
  comment_bank_id uuid,
  callout_id      text,
  attempts        integer,
  last_error      text,
  source          text,
  created_at      timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = private, public
AS $$
BEGIN
  IF (SELECT public.is_super_admin()) THEN
    RETURN QUERY
      SELECT cs.id, cs.wallet_id, cs.mint_address, cs.status, cs.scheduled_for,
             cs.posted_at, cs.comment_bank_id, cs.callout_id, cs.attempts, cs.last_error,
             cs.source, cs.created_at
      FROM private.comment_schedule cs
      WHERE (p_status IS NULL OR cs.status = p_status)
      ORDER BY cs.scheduled_for DESC
      LIMIT p_limit;

  ELSIF auth.uid() IS NOT NULL THEN
    RETURN QUERY
      SELECT cs.id, cs.wallet_id, cs.mint_address, cs.status, cs.scheduled_for,
             cs.posted_at, cs.comment_bank_id, cs.callout_id, cs.attempts, cs.last_error,
             cs.source, cs.created_at
      FROM private.comment_schedule cs
      WHERE cs.user_id = auth.uid()
        AND (p_status IS NULL OR cs.status = p_status)
      ORDER BY cs.scheduled_for DESC
      LIMIT p_limit;

  ELSE
    RETURN;
  END IF;
END;
$$;

REVOKE ALL    ON FUNCTION public.get_comment_schedule(text,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_comment_schedule(text,integer) TO authenticated;


-- ── get_wallet_owner(): resolve a wallet's user_id for enqueue callers ──
-- staggered/buy doesn't run under a user session (it signs directly with the
-- vault keypair, no requireSuperAdmin() call) so there's no auth.uid() to
-- hang comment_schedule.user_id off of — the wallet's own owner is the
-- correct value regardless, since the bank/schedule belong to whoever owns
-- the wallet that's posting, not whoever happened to trigger the buy.
DROP FUNCTION IF EXISTS public.get_wallet_owner(uuid);

CREATE OR REPLACE FUNCTION public.get_wallet_owner(p_wallet_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = private, public
AS $$
DECLARE
  v_owner uuid;
BEGIN
  IF auth.role() != 'service_role' THEN
    RAISE EXCEPTION 'Unauthorized: requires service_role';
  END IF;

  SELECT user_id INTO v_owner FROM private.wallets WHERE id = p_wallet_id;
  RETURN v_owner;
END;
$$;

REVOKE ALL ON FUNCTION public.get_wallet_owner(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_wallet_owner(uuid) FROM authenticated;
REVOKE ALL ON FUNCTION public.get_wallet_owner(uuid) FROM anon;
