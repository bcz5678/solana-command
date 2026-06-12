-- ============================================================
-- ADDRESS LOOKUP TABLES (ALT) REFERENCE STORAGE
-- Stores references to on-chain Solana Address Lookup Tables.
-- The ALT itself lives on-chain; this stores the pointer + metadata.
-- ============================================================

-- ===========================================================
-- TABLE: private.lookup_tables
-- ===========================================================

CREATE TABLE IF NOT EXISTS private.lookup_tables (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Owner — the user who created/manages this ALT
  user_id           uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  -- On-chain ALT account public address — safe to store and display
  public_address    text        NOT NULL UNIQUE,

  -- Local display name for easy reference in the UI
  display_name      text        NOT NULL,

  -- Optional metadata
  description       text,
  chain             text        NOT NULL DEFAULT 'solana',

  -- ALT lifecycle state
  -- 'active'      → in use, extendable
  -- 'frozen'      → deactivated/frozen on-chain (no more extends)
  -- 'deactivated' → marked for closure (cooldown before close)
  status            text        NOT NULL DEFAULT 'active'
                    CHECK (status IN ('active', 'frozen', 'deactivated')),

  -- Number of addresses currently stored in the ALT (cached count)
  address_count     integer     NOT NULL DEFAULT 0,

  -- The authority that can extend/freeze the ALT (public key only)
  authority_address text,

  -- On-chain creation transaction signature
  creation_tx_sig   text,

  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_lookup_tables_user
  ON private.lookup_tables (user_id, status);

CREATE INDEX IF NOT EXISTS idx_lookup_tables_address
  ON private.lookup_tables (public_address);

ALTER TABLE private.lookup_tables ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.lookup_tables FORCE ROW LEVEL SECURITY;

-- No direct API access — all reads/writes via security definer functions
CREATE POLICY "lookup_tables_no_direct_access"
  ON private.lookup_tables
  FOR ALL
  USING (false);

-- Auto-update updated_at (reuses the shared trigger function)
DROP TRIGGER IF EXISTS lookup_tables_updated_at ON private.lookup_tables;
CREATE TRIGGER lookup_tables_updated_at
  BEFORE UPDATE ON private.lookup_tables
  FOR EACH ROW EXECUTE FUNCTION private.set_updated_at();


-- ===========================================================
-- VIEW: public.lookup_tables_public_view
-- Safe read-only projection for frontend display
-- ===========================================================

CREATE OR REPLACE VIEW public.lookup_tables_public_view
WITH (security_invoker = true)
AS
  SELECT
    id,
    user_id,
    public_address,
    display_name,
    description,
    chain,
    status,
    address_count,
    authority_address,
    creation_tx_sig,
    created_at,
    updated_at
  FROM private.lookup_tables;

REVOKE ALL   ON public.lookup_tables_public_view FROM PUBLIC;
REVOKE ALL   ON public.lookup_tables_public_view FROM anon;
GRANT SELECT ON public.lookup_tables_public_view TO authenticated;


-- ===========================================================
-- FUNCTION: public.create_lookup_table()
-- Registers a new ALT reference after on-chain creation.
-- ===========================================================

CREATE OR REPLACE FUNCTION public.create_lookup_table(
  p_public_address    text,
  p_display_name      text,
  p_description       text    DEFAULT NULL,
  p_chain             text    DEFAULT 'solana',
  p_authority_address text    DEFAULT NULL,
  p_creation_tx_sig   text    DEFAULT NULL,
  p_address_count     integer DEFAULT 0
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
    address_count
  )
  VALUES (
    auth.uid(),
    p_public_address,
    p_display_name,
    p_description,
    p_chain,
    p_authority_address,
    p_creation_tx_sig,
    p_address_count
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
      'chain',          p_chain
    )
  );

  RETURN jsonb_build_object(
    'id',             v_id,
    'public_address', p_public_address,
    'display_name',   p_display_name
  );
END;
$$;

REVOKE ALL    ON FUNCTION public.create_lookup_table(text,text,text,text,text,text,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_lookup_table(text,text,text,text,text,text,integer) TO authenticated;


-- ===========================================================
-- FUNCTION: public.get_lookup_tables()
-- Returns lookup tables — own for users, all for super admins.
-- ===========================================================

CREATE OR REPLACE FUNCTION public.get_lookup_tables(
  target_user_id uuid DEFAULT NULL
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
        lt.authority_address, lt.creation_tx_sig,
        lt.created_at, lt.updated_at
      FROM private.lookup_tables lt
      WHERE (target_user_id IS NULL OR lt.user_id = target_user_id)
      ORDER BY lt.created_at DESC;

  ELSIF auth.uid() IS NOT NULL THEN
    RETURN QUERY
      SELECT
        lt.id, lt.user_id, lt.public_address, lt.display_name,
        lt.description, lt.chain, lt.status, lt.address_count,
        lt.authority_address, lt.creation_tx_sig,
        lt.created_at, lt.updated_at
      FROM private.lookup_tables lt
      WHERE lt.user_id = auth.uid()
      ORDER BY lt.created_at DESC;

  ELSE
    RETURN;
  END IF;
END;
$$;

REVOKE ALL    ON FUNCTION public.get_lookup_tables(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_lookup_tables(uuid) TO authenticated;


-- ===========================================================
-- FUNCTION: public.update_lookup_table()
-- Updates display name, description, status, or address count.
-- Three-state logic for nullable text fields.
-- ===========================================================

CREATE OR REPLACE FUNCTION public.update_lookup_table(
  p_id              uuid,
  p_display_name    text    DEFAULT NULL,
  p_description     text    DEFAULT NULL,
  p_status          text    DEFAULT NULL,
  p_address_count   integer DEFAULT NULL,
  p_creation_tx_sig text    DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = private, public
AS $$
DECLARE
  v_current private.lookup_tables%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  SELECT * INTO v_current
  FROM   private.lookup_tables
  WHERE  id = p_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Lookup table % not found', p_id;
  END IF;

  -- Ownership check
  IF v_current.user_id != auth.uid()
    AND NOT (SELECT public.is_super_admin())
  THEN
    RAISE EXCEPTION 'Unauthorized: lookup table not owned by caller';
  END IF;

  -- Validate status if provided
  IF p_status IS NOT NULL
    AND p_status NOT IN ('active', 'frozen', 'deactivated')
  THEN
    RAISE EXCEPTION 'Invalid status: % (must be active, frozen, or deactivated)',
      p_status;
  END IF;

  UPDATE private.lookup_tables
  SET
    display_name    = COALESCE(p_display_name, display_name),
    description     = CASE WHEN p_description     IS NULL THEN description     ELSE NULLIF(p_description,     '') END,
    status          = COALESCE(p_status,          status),
    address_count   = COALESCE(p_address_count,   address_count),
    creation_tx_sig = CASE WHEN p_creation_tx_sig IS NULL THEN creation_tx_sig ELSE NULLIF(p_creation_tx_sig, '') END,
    updated_at      = now()
  WHERE id = p_id;

  INSERT INTO private.audit_logs (user_id, action, record_id, metadata)
  VALUES (
    auth.uid(),
    'lookup_table_updated',
    p_id,
    jsonb_strip_nulls(jsonb_build_object(
      'display_name',  p_display_name,
      'description',   p_description,
      'status',        p_status,
      'address_count', p_address_count
    ))
  );

  RETURN jsonb_build_object(
    'id',           p_id,
    'display_name', COALESCE(p_display_name, v_current.display_name),
    'status',       COALESCE(p_status,       v_current.status),
    'updated_at',   now()
  );
END;
$$;

REVOKE ALL    ON FUNCTION public.update_lookup_table(uuid,text,text,text,integer,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.update_lookup_table(uuid,text,text,text,integer,text) TO authenticated;


-- ===========================================================
-- FUNCTION: public.delete_lookup_table()
-- Removes a lookup table reference from the DB.
-- Does NOT close the on-chain ALT — that's a separate tx.
-- ===========================================================

CREATE OR REPLACE FUNCTION public.delete_lookup_table(
  p_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = private, public
AS $$
DECLARE
  v_user_id        uuid;
  v_public_address text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  SELECT user_id, public_address
  INTO   v_user_id, v_public_address
  FROM   private.lookup_tables
  WHERE  id = p_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Lookup table % not found', p_id;
  END IF;

  -- Ownership check
  IF v_user_id != auth.uid()
    AND NOT (SELECT public.is_super_admin())
  THEN
    RAISE EXCEPTION 'Unauthorized: lookup table not owned by caller';
  END IF;

  DELETE FROM private.lookup_tables WHERE id = p_id;

  INSERT INTO private.audit_logs (user_id, action, record_id, metadata)
  VALUES (
    auth.uid(),
    'lookup_table_deleted',
    p_id,
    jsonb_build_object('public_address', v_public_address)
  );

  RETURN jsonb_build_object('id', p_id, 'deleted', true);
END;
$$;

REVOKE ALL    ON FUNCTION public.delete_lookup_table(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.delete_lookup_table(uuid) TO authenticated;


-- ===========================================================
-- VERIFICATION
-- ===========================================================

SELECT column_name, data_type
FROM   information_schema.columns
WHERE  table_schema = 'private'
  AND  table_name   = 'lookup_tables'
ORDER BY ordinal_position;