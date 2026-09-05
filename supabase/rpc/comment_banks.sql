-- comment_banks: named, multi-selectable comment banks — supersedes the
-- single flat per-user bank from comment_bank.sql with real bank entities
-- you can create/rename/delete, each either generic (usable on any token)
-- or scoped to one specific mint. A trade's auto-comment config selects one
-- OR MORE banks; at fire time the scheduler picks the least-used entry
-- across the UNION of the selected banks, so a fresh token-specific bank
-- naturally gets used before dipping into a well-worn generic one.
--
-- Depends on comment_bank.sql and comment_schedule.sql already being applied
-- — this file ALTERs both of those tables. Run this in the Supabase SQL
-- editor (Studio) after those two. Not wired into `supabase db push` — this
-- repo has no migrations directory, schema changes are applied by hand.

-- ── Schema: private.comment_banks (the bank entities) ────────────
CREATE TABLE IF NOT EXISTS private.comment_banks (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name         text NOT NULL,
  description  text,
  -- NULL = generic (usable for any token). Set = only relevant/offered when
  -- auto-commenting on this specific mint.
  mint_address text,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_comment_banks_user_mint
  ON private.comment_banks (user_id, mint_address);


-- ── Schema: private.comment_bank gets bank_id ────────────────────
ALTER TABLE private.comment_bank
  ADD COLUMN IF NOT EXISTS bank_id uuid REFERENCES private.comment_banks(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_comment_bank_bank_selection
  ON private.comment_bank (bank_id, is_active, used_count, last_used_at);

-- Backfill: every user who already has entries from before banks existed
-- (comment_bank.sql shipped with a flat per-user bank, bank_id was always
-- NULL) gets a "Default" bank created and their orphaned entries assigned
-- to it, so nothing already imported becomes unreachable.
DO $$
DECLARE
  r RECORD;
  v_bank_id uuid;
BEGIN
  FOR r IN SELECT DISTINCT user_id FROM private.comment_bank WHERE bank_id IS NULL LOOP
    INSERT INTO private.comment_banks (user_id, name, description, mint_address)
    VALUES (r.user_id, 'Default', 'Auto-created from your existing comment bank', NULL)
    RETURNING id INTO v_bank_id;

    UPDATE private.comment_bank SET bank_id = v_bank_id WHERE user_id = r.user_id AND bank_id IS NULL;
  END LOOP;
END $$;


-- ── Schema: private.comment_schedule gets bank_ids ───────────────
-- Array, not a join table — this list is fixed at enqueue time and only
-- ever read back whole by the sweep loop, so a join table would be pure
-- overhead for no query flexibility gained.
ALTER TABLE private.comment_schedule
  ADD COLUMN IF NOT EXISTS bank_ids uuid[] NOT NULL DEFAULT '{}';


-- ── create_comment_bank() ─────────────────────────────────────────
DROP FUNCTION IF EXISTS public.create_comment_bank(text,text,text);

CREATE OR REPLACE FUNCTION public.create_comment_bank(
  p_name         text,
  p_description  text DEFAULT NULL,
  p_mint_address text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = private, public
AS $$
DECLARE
  v_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  IF p_name IS NULL OR btrim(p_name) = '' THEN
    RAISE EXCEPTION 'name is required';
  END IF;

  INSERT INTO private.comment_banks (user_id, name, description, mint_address)
  VALUES (auth.uid(), btrim(p_name), p_description, p_mint_address)
  RETURNING id INTO v_id;

  RETURN jsonb_build_object('id', v_id);
END;
$$;

REVOKE ALL    ON FUNCTION public.create_comment_bank(text,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_comment_bank(text,text,text) TO authenticated;


-- ── list_comment_banks() ──────────────────────────────────────────
-- p_mint_address, when passed, scopes results to generic banks PLUS any
-- bank specific to that mint — exactly the set a trade on that mint should
-- be allowed to pick from. Omit it to list everything (bank management UI).
DROP FUNCTION IF EXISTS public.list_comment_banks(text);

CREATE OR REPLACE FUNCTION public.list_comment_banks(
  p_mint_address text DEFAULT NULL
)
RETURNS TABLE (
  id           uuid,
  name         text,
  description  text,
  mint_address text,
  entry_count  bigint,
  created_at   timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = private, public
AS $$
BEGIN
  IF auth.uid() IS NULL AND NOT (SELECT public.is_super_admin()) THEN
    RETURN;
  END IF;

  RETURN QUERY
    SELECT
      cbk.id, cbk.name, cbk.description, cbk.mint_address,
      COUNT(cb.id) FILTER (WHERE cb.is_active) AS entry_count,
      cbk.created_at
    FROM private.comment_banks cbk
    LEFT JOIN private.comment_bank cb ON cb.bank_id = cbk.id
    WHERE (
      (SELECT public.is_super_admin()) OR cbk.user_id = auth.uid()
    )
    AND (
      p_mint_address IS NULL
      OR cbk.mint_address IS NULL
      OR cbk.mint_address = p_mint_address
    )
    GROUP BY cbk.id
    ORDER BY cbk.mint_address IS NOT NULL DESC, cbk.created_at ASC;
END;
$$;

REVOKE ALL    ON FUNCTION public.list_comment_banks(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.list_comment_banks(text) TO authenticated;


-- ── rename_comment_bank() ──────────────────────────────────────────
DROP FUNCTION IF EXISTS public.rename_comment_bank(uuid,text,text);

CREATE OR REPLACE FUNCTION public.rename_comment_bank(
  p_id          uuid,
  p_name        text,
  p_description text DEFAULT NULL
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

  IF p_name IS NULL OR btrim(p_name) = '' THEN
    RAISE EXCEPTION 'name is required';
  END IF;

  UPDATE private.comment_banks
  SET name = btrim(p_name), description = COALESCE(p_description, description)
  WHERE id = p_id
    AND (user_id = auth.uid() OR (SELECT public.is_super_admin()));
END;
$$;

REVOKE ALL    ON FUNCTION public.rename_comment_bank(uuid,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rename_comment_bank(uuid,text,text) TO authenticated;


-- ── delete_comment_bank() ──────────────────────────────────────────
-- Cascades to its entries (comment_bank.bank_id has ON DELETE CASCADE).
-- Does NOT touch comment_schedule rows that already reference this bank in
-- their bank_ids array — those are historical/in-flight and process fine
-- even if the bank vanishes mid-flight (claim_comment_bank_entry just finds
-- fewer candidates); no FK there by design; see comment_schedule.bank_ids.
DROP FUNCTION IF EXISTS public.delete_comment_bank(uuid);

CREATE OR REPLACE FUNCTION public.delete_comment_bank(p_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = private, public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  DELETE FROM private.comment_banks
  WHERE id = p_id
    AND (user_id = auth.uid() OR (SELECT public.is_super_admin()));
END;
$$;

REVOKE ALL    ON FUNCTION public.delete_comment_bank(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.delete_comment_bank(uuid) TO authenticated;


-- ── add_comment_bank_entries(): now bank-scoped ───────────────────
DROP FUNCTION IF EXISTS public.add_comment_bank_entries(text[],text,text);
DROP FUNCTION IF EXISTS public.add_comment_bank_entries(uuid,text[],text);

CREATE OR REPLACE FUNCTION public.add_comment_bank_entries(
  p_bank_id uuid,
  p_texts   text[],
  p_source  text DEFAULT 'manual'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = private, public
AS $$
DECLARE
  v_count integer;
  v_owner uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  SELECT user_id INTO v_owner FROM private.comment_banks WHERE id = p_bank_id;
  IF v_owner IS NULL OR (v_owner != auth.uid() AND NOT (SELECT public.is_super_admin())) THEN
    RAISE EXCEPTION 'Bank not found or not owned by caller';
  END IF;

  IF p_texts IS NULL OR array_length(p_texts, 1) IS NULL THEN
    RAISE EXCEPTION 'p_texts must be a non-empty array';
  END IF;

  INSERT INTO private.comment_bank (user_id, bank_id, text, source)
  SELECT v_owner, p_bank_id, btrim(t), p_source
  FROM unnest(p_texts) AS t
  WHERE btrim(t) <> '';

  GET DIAGNOSTICS v_count = ROW_COUNT;

  RETURN jsonb_build_object('inserted', v_count);
END;
$$;

REVOKE ALL    ON FUNCTION public.add_comment_bank_entries(uuid,text[],text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.add_comment_bank_entries(uuid,text[],text) TO authenticated;


-- ── get_comment_bank(): now bank-scoped ───────────────────────────
DROP FUNCTION IF EXISTS public.get_comment_bank(text,boolean,integer);
DROP FUNCTION IF EXISTS public.get_comment_bank(uuid,boolean,integer);

CREATE OR REPLACE FUNCTION public.get_comment_bank(
  p_bank_id     uuid,
  p_active_only boolean DEFAULT true,
  p_limit       integer DEFAULT 500
)
RETURNS TABLE (
  id           uuid,
  bank_id      uuid,
  text         text,
  source       text,
  is_active    boolean,
  used_count   integer,
  last_used_at timestamptz,
  created_at   timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = private, public
AS $$
BEGIN
  IF (SELECT public.is_super_admin()) THEN
    RETURN QUERY
      SELECT cb.id, cb.bank_id, cb.text, cb.source, cb.is_active, cb.used_count, cb.last_used_at, cb.created_at
      FROM private.comment_bank cb
      WHERE cb.bank_id = p_bank_id
        AND (NOT p_active_only OR cb.is_active)
      ORDER BY cb.used_count ASC, cb.last_used_at ASC NULLS FIRST, cb.created_at ASC
      LIMIT p_limit;

  ELSIF auth.uid() IS NOT NULL THEN
    RETURN QUERY
      SELECT cb.id, cb.bank_id, cb.text, cb.source, cb.is_active, cb.used_count, cb.last_used_at, cb.created_at
      FROM private.comment_bank cb
      WHERE cb.bank_id = p_bank_id
        AND cb.user_id = auth.uid()
        AND (NOT p_active_only OR cb.is_active)
      ORDER BY cb.used_count ASC, cb.last_used_at ASC NULLS FIRST, cb.created_at ASC
      LIMIT p_limit;

  ELSE
    RETURN;
  END IF;
END;
$$;

REVOKE ALL    ON FUNCTION public.get_comment_bank(uuid,boolean,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_comment_bank(uuid,boolean,integer) TO authenticated;


-- ── claim_comment_bank_entry(): now scoped to a SET of banks ──────
-- Least-used-first across the union of p_bank_ids — this is what makes
-- "generic + token-specific" blend naturally: a fresh token-specific bank's
-- entries (used_count 0) get exhausted before the scheduler dips into a
-- well-worn generic bank, with no special-casing needed here.
DROP FUNCTION IF EXISTS public.claim_comment_bank_entry(uuid);
DROP FUNCTION IF EXISTS public.claim_comment_bank_entry(uuid[]);

CREATE OR REPLACE FUNCTION public.claim_comment_bank_entry(
  p_bank_ids uuid[]
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
      WHERE c.bank_id = ANY(p_bank_ids) AND c.is_active
      ORDER BY c.used_count ASC, c.last_used_at ASC NULLS FIRST, c.created_at ASC
      LIMIT 1
      FOR UPDATE SKIP LOCKED
    )
    RETURNING cb.id, cb.text;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_comment_bank_entry(uuid[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.claim_comment_bank_entry(uuid[]) FROM authenticated;
REVOKE ALL ON FUNCTION public.claim_comment_bank_entry(uuid[]) FROM anon;


-- ── enqueue_comment_schedule(): now carries bank_ids ──────────────
DROP FUNCTION IF EXISTS public.enqueue_comment_schedule(uuid,uuid,text,timestamptz,text);
DROP FUNCTION IF EXISTS public.enqueue_comment_schedule(uuid,uuid,text,timestamptz,uuid[],text);

CREATE OR REPLACE FUNCTION public.enqueue_comment_schedule(
  p_user_id       uuid,
  p_wallet_id     uuid,
  p_mint_address  text,
  p_scheduled_for timestamptz,
  p_bank_ids      uuid[],
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

  IF p_bank_ids IS NULL OR array_length(p_bank_ids, 1) IS NULL THEN
    RAISE EXCEPTION 'p_bank_ids must be a non-empty array';
  END IF;

  INSERT INTO private.comment_schedule (user_id, wallet_id, mint_address, scheduled_for, bank_ids, source)
  VALUES (p_user_id, p_wallet_id, p_mint_address, p_scheduled_for, p_bank_ids, p_source)
  ON CONFLICT DO NOTHING
  RETURNING id INTO v_id;

  RETURN jsonb_build_object('id', v_id, 'enqueued', v_id IS NOT NULL);
END;
$$;

REVOKE ALL ON FUNCTION public.enqueue_comment_schedule(uuid,uuid,text,timestamptz,uuid[],text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.enqueue_comment_schedule(uuid,uuid,text,timestamptz,uuid[],text) FROM authenticated;
REVOKE ALL ON FUNCTION public.enqueue_comment_schedule(uuid,uuid,text,timestamptz,uuid[],text) FROM anon;


-- ── claim_due_comment_schedule(): now returns bank_ids too ────────
DROP FUNCTION IF EXISTS public.claim_due_comment_schedule(integer);

CREATE OR REPLACE FUNCTION public.claim_due_comment_schedule(
  p_limit integer DEFAULT 20
)
RETURNS TABLE (
  id           uuid,
  user_id      uuid,
  wallet_id    uuid,
  mint_address text,
  bank_ids     uuid[],
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
    RETURNING cs.id, cs.user_id, cs.wallet_id, cs.mint_address, cs.bank_ids, cs.attempts;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_due_comment_schedule(integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.claim_due_comment_schedule(integer) FROM authenticated;
REVOKE ALL ON FUNCTION public.claim_due_comment_schedule(integer) FROM anon;
