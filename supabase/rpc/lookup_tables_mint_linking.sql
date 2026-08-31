-- lookup_tables: per-mint linking
-- Adds mint_id to private.lookup_tables so a Jito-bundle-trading route can look
-- up "the" dedicated ALT for a given launch (shared pump.fun accounts + every
-- target wallet's ATA) instead of relying on generic overlap-scoring.
--
-- Base table/view/RPCs originally defined in
-- supabase/snippets/Untitled query 808.sql — this file only adds the mint_id
-- column and re-creates the two RPCs that need to know about it
-- (create_lookup_table, get_lookup_tables). update_lookup_table and
-- delete_lookup_table are untouched — mint_id is only ever set at creation.
--
-- Run this in the Supabase SQL editor (Studio). Same auth model as the base
-- file: authenticated + is_super_admin()-aware, not service_role-only — a
-- lookup table's public_address is on-chain public data, not a secret.

-- ── Schema ──────────────────────────────────────────────────────
ALTER TABLE private.lookup_tables
  ADD COLUMN IF NOT EXISTS mint_id uuid REFERENCES private.token_mints(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_lookup_tables_mint
  ON private.lookup_tables (mint_id)
  WHERE mint_id IS NOT NULL;

-- At most one *active* ALT per mint — callers resolving "the" ALT for a mint
-- should get an unambiguous answer. A frozen/deactivated table can still be
-- superseded by a new active one for the same mint (partial index only
-- constrains status = 'active' rows).
CREATE UNIQUE INDEX IF NOT EXISTS idx_lookup_tables_one_active_per_mint
  ON private.lookup_tables (mint_id)
  WHERE status = 'active' AND mint_id IS NOT NULL;


-- ── create_lookup_table(): add p_mint_id ──────────────────────────
DROP FUNCTION IF EXISTS public.create_lookup_table(text,text,text,text,text,text,integer);

CREATE OR REPLACE FUNCTION public.create_lookup_table(
  p_public_address    text,
  p_display_name      text,
  p_description       text    DEFAULT NULL,
  p_chain             text    DEFAULT 'solana',
  p_authority_address text    DEFAULT NULL,
  p_creation_tx_sig   text    DEFAULT NULL,
  p_address_count     integer DEFAULT 0,
  p_mint_id           uuid    DEFAULT NULL
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

  IF p_public_address IS NULL OR p_display_name IS NULL THEN
    RAISE EXCEPTION 'public_address and display_name are required';
  END IF;

  INSERT INTO private.lookup_tables (
    user_id,
    public_address,
    display_name,
    description,
    chain,
    authority_address,
    creation_tx_sig,
    address_count,
    mint_id
  )
  VALUES (
    auth.uid(),
    p_public_address,
    p_display_name,
    p_description,
    p_chain,
    p_authority_address,
    p_creation_tx_sig,
    p_address_count,
    p_mint_id
  )
  RETURNING id INTO v_id;

  INSERT INTO private.audit_logs (user_id, action, record_id, metadata)
  VALUES (
    auth.uid(),
    'lookup_table_created',
    v_id,
    jsonb_build_object(
      'public_address', p_public_address,
      'display_name',   p_display_name,
      'chain',          p_chain,
      'mint_id',        p_mint_id
    )
  );

  RETURN jsonb_build_object(
    'id',             v_id,
    'public_address', p_public_address,
    'display_name',   p_display_name,
    'mint_id',        p_mint_id
  );
END;
$$;

REVOKE ALL    ON FUNCTION public.create_lookup_table(text,text,text,text,text,text,integer,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_lookup_table(text,text,text,text,text,text,integer,uuid) TO authenticated;


-- ── get_lookup_tables(): add p_mint_id filter + mint_id in output ─
DROP FUNCTION IF EXISTS public.get_lookup_tables(uuid);

CREATE OR REPLACE FUNCTION public.get_lookup_tables(
  target_user_id uuid DEFAULT NULL,
  p_mint_id      uuid DEFAULT NULL
)
RETURNS TABLE (
  id                uuid,
  user_id           uuid,
  public_address    text,
  display_name      text,
  description       text,
  chain             text,
  status            text,
  address_count     integer,
  authority_address text,
  creation_tx_sig   text,
  mint_id           uuid,
  created_at        timestamptz,
  updated_at        timestamptz
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
        lt.id, lt.user_id, lt.public_address, lt.display_name,
        lt.description, lt.chain, lt.status, lt.address_count,
        lt.authority_address, lt.creation_tx_sig, lt.mint_id,
        lt.created_at, lt.updated_at
      FROM private.lookup_tables lt
      WHERE (target_user_id IS NULL OR lt.user_id = target_user_id)
        AND (p_mint_id IS NULL OR lt.mint_id = p_mint_id)
      ORDER BY lt.created_at DESC;

  ELSIF auth.uid() IS NOT NULL THEN
    RETURN QUERY
      SELECT
        lt.id, lt.user_id, lt.public_address, lt.display_name,
        lt.description, lt.chain, lt.status, lt.address_count,
        lt.authority_address, lt.creation_tx_sig, lt.mint_id,
        lt.created_at, lt.updated_at
      FROM private.lookup_tables lt
      WHERE lt.user_id = auth.uid()
        AND (p_mint_id IS NULL OR lt.mint_id = p_mint_id)
      ORDER BY lt.created_at DESC;

  ELSE
    RETURN;
  END IF;
END;
$$;

REVOKE ALL    ON FUNCTION public.get_lookup_tables(uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_lookup_tables(uuid,uuid) TO authenticated;
