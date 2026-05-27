CREATE OR REPLACE FUNCTION public.update_vanity_keypair_status(
  p_keypair_id uuid,
  p_status     text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = private, public
AS $$
DECLARE
  v_current private.vanity_keypairs%ROWTYPE;
BEGIN
  -- ── Auth ──────────────────────────────────────────────────
  IF NOT (SELECT public.is_super_admin()) THEN
    RAISE EXCEPTION 'Unauthorized: super admin required';
  END IF;

  -- ── Validate target status ─────────────────────────────────
  IF p_status NOT IN ('available', 'reserved', 'used', 'revoked') THEN
    RAISE EXCEPTION 'Invalid status: % — must be available, reserved, used, or revoked',
      p_status;
  END IF;

  -- ── Fetch current row ──────────────────────────────────────
  SELECT * INTO v_current
  FROM   private.vanity_keypairs
  WHERE  id = p_keypair_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Vanity keypair % not found', p_keypair_id;
  END IF;

  -- ── Guard invalid transitions ──────────────────────────────
  -- 'used' keypairs are permanently retired — cannot be moved back
  IF v_current.status = 'used' THEN
    RAISE EXCEPTION
      'Keypair % is permanently used — status cannot be changed', p_keypair_id;
  END IF;

  -- ── Apply status transition ────────────────────────────────
  UPDATE private.vanity_keypairs
  SET
    status      = p_status,
    revoked_at  = CASE WHEN p_status = 'revoked' THEN now() ELSE revoked_at END,
    revoked_by  = CASE WHEN p_status = 'revoked' THEN auth.uid() ELSE revoked_by END,
    -- Clear assignment fields if returning to available
    assigned_mint_id = CASE WHEN p_status = 'available' THEN NULL ELSE assigned_mint_id END,
    assigned_at      = CASE WHEN p_status = 'available' THEN NULL ELSE assigned_at END,
    assigned_by      = CASE WHEN p_status = 'available' THEN NULL ELSE assigned_by END
  WHERE id = p_keypair_id;

  -- ── Audit ──────────────────────────────────────────────────
  INSERT INTO private.audit_logs (user_id, action, record_id, metadata)
  VALUES (
    auth.uid(),
    'vanity_keypair_status_updated',
    p_keypair_id,
    jsonb_build_object(
      'public_key',  v_current.public_key,
      'from_status', v_current.status,
      'to_status',   p_status
    )
  );

  RETURN jsonb_build_object(
    'keypair_id',  p_keypair_id,
    'public_key',  v_current.public_key,
    'from_status', v_current.status,
    'to_status',   p_status
  );
END;
$$;

REVOKE ALL    ON FUNCTION public.update_vanity_keypair_status(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.update_vanity_keypair_status(uuid, text) TO authenticated;