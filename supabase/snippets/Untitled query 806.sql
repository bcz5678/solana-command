-- ============================================================
-- Builds a token draft record in DB — no on-chain action.
-- Links the claimed vanity keypair + dev wallet to the token.
-- Returns the mint_id for Phase 3 (launch).
-- ============================================================
CREATE OR REPLACE FUNCTION public.build_token_draft(
  -- Vanity keypair (from claim-vanity phase)
  p_keypair_id          uuid,

  -- Dev wallet (must be owned by caller)
  p_dev_wallet_id       uuid,

  -- Token metadata
  p_token_name          text,
  p_token_symbol        text,
  p_decimals            smallint  DEFAULT 9,
  p_token_type          text      DEFAULT 'fungible',
  p_max_supply          numeric   DEFAULT NULL,
  p_metadata_uri        text      DEFAULT NULL,
  p_freeze_authority_key text     DEFAULT NULL,
  p_update_authority_key text     DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = private, public
AS $$
DECLARE
  v_mint_id           uuid;
  v_mint_public_key   text;
  v_vault_secret_name text;
BEGIN
  -- ── Auth ──────────────────────────────────────────────────
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  -- ── Validate vanity keypair is reserved by this session ───
  -- Prevents using a keypair that belongs to another user's session
  SELECT public_key, vault_secret_name
  INTO   v_mint_public_key, v_vault_secret_name
  FROM   private.vanity_keypairs
  WHERE  id     = p_keypair_id
    AND  status = 'reserved';   -- must be reserved, not available or used

  IF v_mint_public_key IS NULL THEN
    RAISE EXCEPTION 'Vanity keypair % not found or not in reserved state',
      p_keypair_id;
  END IF;

  -- ── Validate dev wallet belongs to caller ─────────────────
  IF NOT EXISTS (
    SELECT 1 FROM public.wallet_owners
    WHERE  wallet_id = p_dev_wallet_id
      AND  user_id   = auth.uid()
      AND  is_active = true
      AND  can_sign  = true     -- dev wallet must be signable
  ) THEN
    RAISE EXCEPTION 'Dev wallet % not found or not owned by caller',
      p_dev_wallet_id;
  END IF;

  -- ── Insert draft token record ──────────────────────────────
  INSERT INTO private.token_mints (
    user_id,
    mint_public_key,
    vault_secret_name,
    token_name,
    token_symbol,
    decimals,
    token_type,
    max_supply,
    metadata_uri,
    freeze_authority_key,
    update_authority_key,
    dev_wallet_id,
    vanity_keypair_id,
    launch_status,        -- draft until explicitly launched
    is_active
  )
  VALUES (
    auth.uid(),
    v_mint_public_key,
    v_vault_secret_name,
    p_token_name,
    p_token_symbol,
    p_decimals,
    p_token_type,
    p_max_supply,
    p_metadata_uri,
    p_freeze_authority_key,
    p_update_authority_key,
    p_dev_wallet_id,
    p_keypair_id,
    'draft',
    true
  )
  RETURNING id INTO v_mint_id;

  -- ── Audit ──────────────────────────────────────────────────
  INSERT INTO private.audit_logs (user_id, action, record_id, metadata)
  VALUES (
    auth.uid(),
    'token_draft_created',
    v_mint_id,
    jsonb_build_object(
      'token_name',     p_token_name,
      'token_symbol',   p_token_symbol,
      'mint_public_key', v_mint_public_key,
      'dev_wallet_id',  p_dev_wallet_id,
      'keypair_id',     p_keypair_id
      -- vault_secret_name excluded from audit
    )
  );

  RETURN jsonb_build_object(
    'mint_id',          v_mint_id,
    'mint_public_key',  v_mint_public_key,
    'launch_status',    'draft'
  );
END;
$$;

REVOKE ALL    ON FUNCTION public.build_token_draft(uuid,uuid,text,text,smallint,text,numeric,text,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.build_token_draft(uuid,uuid,text,text,smallint,text,numeric,text,text,text) TO authenticated;