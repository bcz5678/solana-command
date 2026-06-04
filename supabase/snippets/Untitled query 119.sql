-- ============================================================
-- LAUNCH SUPPORT FUNCTIONS
-- Fetches everything the launch route needs in one call,
-- and transitions token state after a confirmed launch.
-- ============================================================

-- ── get_token_launch_data() ──────────────────────────────────
-- Returns all DB fields + BOTH vault secret names needed to launch:
--   the mint authority key (token_mints.vault_secret_name)
--   the dev wallet key      (wallets.vault_secret_name)
-- service_role only — the route uses the admin client.
CREATE OR REPLACE FUNCTION public.get_token_launch_data(
  p_mint_id uuid
)
RETURNS TABLE (
  mint_id                   uuid,
  mint_public_key           text,
  mint_vault_secret_name    text,
  token_name                text,
  token_symbol              text,
  metadata_uri              text,
  decimals                  smallint,
  launch_status             text,
  vanity_keypair_id         uuid,
  dev_wallet_id             uuid,
  dev_wallet_public_key     text,
  dev_wallet_vault_secret   text
)
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = private, public
AS $$
BEGIN
  -- service_role only — launch is a privileged server operation
  IF auth.role() != 'service_role' THEN
    RAISE EXCEPTION 'Unauthorized: launch data requires service_role';
  END IF;

  RETURN QUERY
    SELECT
      tm.id,
      tm.mint_public_key,
      tm.vault_secret_name        AS mint_vault_secret_name,
      tm.token_name,
      tm.token_symbol,
      tm.metadata_uri,
      tm.decimals,
      tm.launch_status,
      tm.vanity_keypair_id,
      tm.dev_wallet_id,
      w.public_key                AS dev_wallet_public_key,
      w.vault_secret_name         AS dev_wallet_vault_secret
    FROM   private.token_mints tm
    LEFT   JOIN private.wallets w ON w.id = tm.dev_wallet_id
    WHERE  tm.id = p_mint_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Token mint % not found', p_mint_id;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.get_token_launch_data(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_token_launch_data(uuid) FROM anon;
REVOKE ALL ON FUNCTION public.get_token_launch_data(uuid) FROM authenticated;


-- ── mark_token_launching() ───────────────────────────────────
-- Transitions draft → launching BEFORE sending the tx.
-- Acts as a lock — prevents double-launch of the same draft.
-- service_role only.
CREATE OR REPLACE FUNCTION public.mark_token_launching(
  p_mint_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = private, public
AS $$
DECLARE
  v_status text;
BEGIN
  IF auth.role() != 'service_role' THEN
    RAISE EXCEPTION 'Unauthorized: requires service_role';
  END IF;

  SELECT launch_status INTO v_status
  FROM   private.token_mints
  WHERE  id = p_mint_id
  FOR UPDATE;

  IF v_status IS NULL THEN
    RAISE EXCEPTION 'Token mint % not found', p_mint_id;
  END IF;

  -- Only a draft can begin launching
  IF v_status != 'draft' THEN
    RAISE EXCEPTION 'Token % is not in draft status (current: %)',
      p_mint_id, v_status;
  END IF;

  UPDATE private.token_mints
  SET    launch_status = 'launching',
         updated_at    = now()
  WHERE  id = p_mint_id;

  RETURN jsonb_build_object('mint_id', p_mint_id, 'launch_status', 'launching');
END;
$$;

REVOKE ALL ON FUNCTION public.mark_token_launching(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.mark_token_launching(uuid) FROM anon;
REVOKE ALL ON FUNCTION public.mark_token_launching(uuid) FROM authenticated;


-- ── complete_token_launch() ──────────────────────────────────
-- Called after the on-chain tx is confirmed.
-- Sets launch_status = 'launched', records the tx signature,
-- and permanently retires the vanity keypair (reserved → used).
-- service_role only.
CREATE OR REPLACE FUNCTION public.complete_token_launch(
  p_mint_id      uuid,
  p_tx_signature text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = private, public
AS $$
DECLARE
  v_keypair_id uuid;
BEGIN
  IF auth.role() != 'service_role' THEN
    RAISE EXCEPTION 'Unauthorized: requires service_role';
  END IF;

  -- Mark token launched
  UPDATE private.token_mints
  SET    launch_status = 'launched',
         updated_at    = now()
  WHERE  id = p_mint_id
  RETURNING vanity_keypair_id INTO v_keypair_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Token mint % not found', p_mint_id;
  END IF;

  -- Permanently retire the vanity keypair
  IF v_keypair_id IS NOT NULL THEN
    UPDATE private.vanity_keypairs
    SET    status           = 'used',
           assigned_mint_id = p_mint_id,
           assigned_at      = COALESCE(assigned_at, now())
    WHERE  id     = v_keypair_id
      AND  status = 'reserved';
  END IF;

  -- Log to mint_logs
  INSERT INTO private.mint_logs (
    mint_id, recipient_address, amount, decimals,
    operation, tx_signature, status, created_at
  )
  SELECT
    p_mint_id, tm.mint_public_key, 0, tm.decimals,
    'mint', p_tx_signature, 'confirmed', now()
  FROM private.token_mints tm
  WHERE tm.id = p_mint_id;

  RETURN jsonb_build_object(
    'mint_id',       p_mint_id,
    'launch_status', 'launched',
    'tx_signature',  p_tx_signature
  );
END;
$$;

REVOKE ALL ON FUNCTION public.complete_token_launch(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.complete_token_launch(uuid, text) FROM anon;
REVOKE ALL ON FUNCTION public.complete_token_launch(uuid, text) FROM authenticated;


-- ── fail_token_launch() ──────────────────────────────────────
-- Called if the on-chain tx fails.
-- Reverts launching → draft so it can be retried,
-- keypair stays 'reserved' (still tied to this draft).
-- service_role only.
CREATE OR REPLACE FUNCTION public.fail_token_launch(
  p_mint_id uuid,
  p_reason  text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = private, public
AS $$
BEGIN
  IF auth.role() != 'service_role' THEN
    RAISE EXCEPTION 'Unauthorized: requires service_role';
  END IF;

  -- Revert to draft so the launch can be retried
  UPDATE private.token_mints
  SET    launch_status = 'draft',
         updated_at    = now()
  WHERE  id = p_mint_id
    AND  launch_status = 'launching';

  INSERT INTO private.audit_logs (action, record_id, metadata)
  VALUES (
    'token_launch_failed',
    p_mint_id,
    jsonb_build_object('reason', COALESCE(p_reason, 'unknown'), 'failed_at', now())
  );

  RETURN jsonb_build_object('mint_id', p_mint_id, 'launch_status', 'draft');
END;
$$;

REVOKE ALL ON FUNCTION public.fail_token_launch(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fail_token_launch(uuid, text) FROM anon;
REVOKE ALL ON FUNCTION public.fail_token_launch(uuid, text) FROM authenticated;