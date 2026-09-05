-- auto_comment_stats: rolling-window controller for the "chance to comment"
-- knob on auto-comment (see comment_schedule.sql / comment-scheduler.ts).
--
-- A flat per-wallet coin flip (Math.random() < probability) is bursty at the
-- batch sizes these trades actually run at — at a 30% target, 5 wallets
-- buying together have a real chance of landing 4-5 comments (or 0), which
-- is exactly the kind of clustered pattern that reads as automated rather
-- than organic. This tracks the REALIZED comment rate per (user, mint) and
-- biases each decision toward the configured target, so the rate converges
-- over a run instead of drifting freely.
--
-- Cheap O(1) approximation of a rolling window: rather than storing a
-- timestamped event log, the two counters are halved once they cross a
-- threshold, so older history decays and recent behavior dominates — same
-- idea as an exponential moving average, without needing a full event table.
--
-- Run this in the Supabase SQL editor (Studio) after comment_schedule.sql.
-- Not wired into `supabase db push` — this repo has no migrations
-- directory, schema changes are applied by hand.

CREATE TABLE IF NOT EXISTS private.auto_comment_stats (
  user_id         uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  mint_address    text NOT NULL,
  eligible_count  integer NOT NULL DEFAULT 0,
  commented_count integer NOT NULL DEFAULT 0,
  updated_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, mint_address)
);

-- ── roll_auto_comment_decision(): the actual per-wallet decision ────
-- Call once per eligible wallet (after the enable/bank checks, before
-- enqueueing). Returns whether THIS wallet should get a comment scheduled.
-- FOR UPDATE serializes concurrent calls for the same (user, mint) — bundle
-- buys fire these fire-and-forget in a loop, so without the lock, wallets
-- landing in the same tick would all read the same stale rate and could all
-- decide "yes" together, defeating the point.
DROP FUNCTION IF EXISTS public.roll_auto_comment_decision(uuid,text,numeric);

CREATE OR REPLACE FUNCTION public.roll_auto_comment_decision(
  p_user_id            uuid,
  p_mint_address       text,
  p_target_probability numeric
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = private, public
AS $$
DECLARE
  v_eligible    integer;
  v_commented   integer;
  v_rate        numeric;
  v_effective   numeric;
  v_decision    boolean;
  c_decay_after constant integer := 20;   -- ~last 20 buys' worth of "memory"
  c_correction  constant numeric := 1.5;  -- how hard to pull back toward target
BEGIN
  IF auth.role() != 'service_role' THEN
    RAISE EXCEPTION 'Unauthorized: requires service_role';
  END IF;

  INSERT INTO private.auto_comment_stats (user_id, mint_address)
  VALUES (p_user_id, p_mint_address)
  ON CONFLICT (user_id, mint_address) DO NOTHING;

  SELECT eligible_count, commented_count INTO v_eligible, v_commented
  FROM private.auto_comment_stats
  WHERE user_id = p_user_id AND mint_address = p_mint_address
  FOR UPDATE;

  IF v_eligible >= c_decay_after THEN
    v_eligible  := v_eligible / 2;
    v_commented := v_commented / 2;
  END IF;

  v_rate      := CASE WHEN v_eligible > 0 THEN v_commented::numeric / v_eligible ELSE p_target_probability END;
  v_effective := GREATEST(0, LEAST(1, p_target_probability + (p_target_probability - v_rate) * c_correction));
  v_decision  := random() < v_effective;

  UPDATE private.auto_comment_stats
  SET eligible_count  = v_eligible + 1,
      commented_count = v_commented + (CASE WHEN v_decision THEN 1 ELSE 0 END),
      updated_at      = now()
  WHERE user_id = p_user_id AND mint_address = p_mint_address;

  RETURN v_decision;
END;
$$;

REVOKE ALL ON FUNCTION public.roll_auto_comment_decision(uuid,text,numeric) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.roll_auto_comment_decision(uuid,text,numeric) FROM authenticated;
REVOKE ALL ON FUNCTION public.roll_auto_comment_decision(uuid,text,numeric) FROM anon;
