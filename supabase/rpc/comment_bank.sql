-- comment_bank: persisted store for pre-written pump.fun callout/comment
-- text ("thesis" content), so the comment-bot UI can pull from a durable
-- bank instead of pasting the same lines into a textarea every session.
--
-- get_comment_bank() orders least-used-first (used_count asc, then
-- last_used_at asc nulls first) so pulling the next N entries naturally
-- avoids repeats across wallets/tokens without any client-side bookkeeping —
-- the caller just calls mark_comment_bank_used() after each successful post.
--
-- Run this in the Supabase SQL editor (Studio) to create/update these
-- objects. Not wired into `supabase db push` — this repo has no migrations
-- directory, schema changes are applied by hand via Studio (same as
-- log_trade.sql / lookup_tables_mint_linking.sql).

-- ── Schema ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS private.comment_bank (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  text          text NOT NULL,
  tag           text,
  source        text NOT NULL DEFAULT 'manual',  -- manual | scraped | generated
  is_active     boolean NOT NULL DEFAULT true,
  used_count    integer NOT NULL DEFAULT 0,
  last_used_at  timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_comment_bank_selection
  ON private.comment_bank (user_id, is_active, used_count, last_used_at);

-- private schema — no RLS needed, same reasoning as trade_logs: not
-- PostgREST-exposed, only reachable through the SECURITY DEFINER RPCs below.


-- ── add_comment_bank_entries(): bulk insert ────────────────────────
-- p_texts is the whole pasted bank, one array element per line — the caller
-- splits on newline client-side and drops blanks before calling. Blank/
-- whitespace-only entries are also filtered here as a second guard.
DROP FUNCTION IF EXISTS public.add_comment_bank_entries(text[],text,text);

CREATE OR REPLACE FUNCTION public.add_comment_bank_entries(
  p_texts  text[],
  p_tag    text DEFAULT NULL,
  p_source text DEFAULT 'manual'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = private, public
AS $$
DECLARE
  v_count integer;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  IF p_texts IS NULL OR array_length(p_texts, 1) IS NULL THEN
    RAISE EXCEPTION 'p_texts must be a non-empty array';
  END IF;

  INSERT INTO private.comment_bank (user_id, text, tag, source)
  SELECT auth.uid(), btrim(t), p_tag, p_source
  FROM unnest(p_texts) AS t
  WHERE btrim(t) <> '';

  GET DIAGNOSTICS v_count = ROW_COUNT;

  RETURN jsonb_build_object('inserted', v_count);
END;
$$;

REVOKE ALL    ON FUNCTION public.add_comment_bank_entries(text[],text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.add_comment_bank_entries(text[],text,text) TO authenticated;


-- ── get_comment_bank(): list, least-recently-used first ────────────
DROP FUNCTION IF EXISTS public.get_comment_bank(text,boolean,integer);

CREATE OR REPLACE FUNCTION public.get_comment_bank(
  p_tag         text    DEFAULT NULL,
  p_active_only boolean DEFAULT true,
  p_limit       integer DEFAULT 500
)
RETURNS TABLE (
  id           uuid,
  text         text,
  tag          text,
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
      SELECT cb.id, cb.text, cb.tag, cb.source, cb.is_active, cb.used_count, cb.last_used_at, cb.created_at
      FROM private.comment_bank cb
      WHERE (p_tag IS NULL OR cb.tag = p_tag)
        AND (NOT p_active_only OR cb.is_active)
      ORDER BY cb.used_count ASC, cb.last_used_at ASC NULLS FIRST, cb.created_at ASC
      LIMIT p_limit;

  ELSIF auth.uid() IS NOT NULL THEN
    RETURN QUERY
      SELECT cb.id, cb.text, cb.tag, cb.source, cb.is_active, cb.used_count, cb.last_used_at, cb.created_at
      FROM private.comment_bank cb
      WHERE cb.user_id = auth.uid()
        AND (p_tag IS NULL OR cb.tag = p_tag)
        AND (NOT p_active_only OR cb.is_active)
      ORDER BY cb.used_count ASC, cb.last_used_at ASC NULLS FIRST, cb.created_at ASC
      LIMIT p_limit;

  ELSE
    RETURN;
  END IF;
END;
$$;

REVOKE ALL    ON FUNCTION public.get_comment_bank(text,boolean,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_comment_bank(text,boolean,integer) TO authenticated;


-- ── mark_comment_bank_used(): bump usage after a successful post ───
DROP FUNCTION IF EXISTS public.mark_comment_bank_used(uuid);

CREATE OR REPLACE FUNCTION public.mark_comment_bank_used(p_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = private, public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  UPDATE private.comment_bank
  SET used_count   = used_count + 1,
      last_used_at = now()
  WHERE id = p_id
    AND (user_id = auth.uid() OR (SELECT public.is_super_admin()));
END;
$$;

REVOKE ALL    ON FUNCTION public.mark_comment_bank_used(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mark_comment_bank_used(uuid) TO authenticated;


-- ── delete_comment_bank_entry(): remove a bad line ──────────────────
DROP FUNCTION IF EXISTS public.delete_comment_bank_entry(uuid);

CREATE OR REPLACE FUNCTION public.delete_comment_bank_entry(p_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = private, public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  DELETE FROM private.comment_bank
  WHERE id = p_id
    AND (user_id = auth.uid() OR (SELECT public.is_super_admin()));
END;
$$;

REVOKE ALL    ON FUNCTION public.delete_comment_bank_entry(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.delete_comment_bank_entry(uuid) TO authenticated;
