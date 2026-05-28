CREATE OR REPLACE FUNCTION private.claim_vanity_keypair(
  p_chain          text    DEFAULT 'solana',
  p_vanity_prefix  text    DEFAULT NULL,
  p_mint_id        uuid    DEFAULT NULL,
  p_claimed_by     uuid    DEFAULT NULL
)
RETURNS TABLE (
  keypair_id        uuid,
  public_key        text,
  vault_secret_name text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = private, public
AS $$
DECLARE
  v_id         uuid;
  v_public_key text;
  v_vault_name text;
BEGIN
  -- DB-only super admin check
  IF NOT EXISTS (
    SELECT 1 FROM private.super_admins
    WHERE  user_id    = auth.uid()
      AND  revoked_at IS NULL
  ) THEN
    RAISE EXCEPTION 'Unauthorized: super admin required';
  END IF;

  SELECT vk.id, vk.public_key, vk.vault_secret_name
  INTO   v_id, v_public_key, v_vault_name
  FROM   private.vanity_keypairs vk
  WHERE  vk.status = 'available'
    AND  vk.chain  = p_chain
    AND  (p_vanity_prefix IS NULL OR vk.vanity_suffix = p_vanity_prefix)  -- ← was vanity_prefix
  ORDER BY vk.imported_at ASC
  LIMIT 1
  FOR UPDATE SKIP LOCKED;

  IF v_id IS NULL THEN
    RAISE EXCEPTION 'No available vanity keypairs in pool (chain: %, prefix: %)',
      p_chain, COALESCE(p_vanity_prefix, 'any');
  END IF;

  UPDATE private.vanity_keypairs
  SET
    status           = 'reserved',
    assigned_mint_id = p_mint_id,
    assigned_at      = now(),
    assigned_by      = COALESCE(p_claimed_by, auth.uid())
  WHERE id = v_id;

  INSERT INTO private.audit_logs (user_id, action, record_id, metadata)
  VALUES (
    auth.uid(),
    'vanity_keypair_claimed',
    v_id,
    jsonb_build_object(
      'public_key', v_public_key,
      'mint_id',    p_mint_id,
      'chain',      p_chain
    )
  );

  RETURN QUERY SELECT v_id, v_public_key, v_vault_name;
END;
$$;