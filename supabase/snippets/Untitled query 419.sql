-- ============================================================
-- Fetches the vault secret name for a wallet by its UUID.
-- service_role only — never callable from client.
-- ============================================================
CREATE OR REPLACE FUNCTION private.get_wallet_secret_by_id(
  p_wallet_id uuid
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = vault, private, public
AS $$
DECLARE
  v_secret_name  text;
  v_secret_value text;
BEGIN
  -- service_role only
  IF auth.role() != 'service_role' THEN
    RAISE EXCEPTION 'Unauthorized: requires service_role';
  END IF;

  -- Fetch vault pointer from wallet record
  SELECT vault_secret_name INTO v_secret_name
  FROM   private.wallets
  WHERE  id        = p_wallet_id
    AND  is_active = true;

  IF v_secret_name IS NULL THEN
    RAISE EXCEPTION 'Wallet % not found, inactive, or has no vault secret', p_wallet_id;
  END IF;

  -- Fetch decrypted secret from vault
  SELECT decrypted_secret INTO v_secret_value
  FROM   vault.decrypted_secrets
  WHERE  name = v_secret_name;

  IF v_secret_value IS NULL THEN
    RAISE EXCEPTION 'Vault secret not found for wallet: %', p_wallet_id;
  END IF;

  RETURN v_secret_value;
END;
$$;

-- No user access — service_role direct DB call only
REVOKE ALL ON FUNCTION private.get_wallet_secret_by_id(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION private.get_wallet_secret_by_id(uuid) FROM authenticated;
REVOKE ALL ON FUNCTION private.get_wallet_secret_by_id(uuid) FROM anon;

-- ============================================================
-- Public wrapper — callable via admin client .rpc()
-- ============================================================
CREATE OR REPLACE FUNCTION public.get_wallet_secret_by_id(
  p_wallet_id uuid
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = vault, private, public
AS $$
BEGIN
  IF auth.role() != 'service_role' THEN
    RAISE EXCEPTION 'Unauthorized: requires service_role';
  END IF;

  RETURN private.get_wallet_secret_by_id(p_wallet_id);
END;
$$;

-- service_role only — no user access
REVOKE ALL ON FUNCTION public.get_wallet_secret_by_id(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_wallet_secret_by_id(uuid) FROM authenticated;
REVOKE ALL ON FUNCTION public.get_wallet_secret_by_id(uuid) FROM anon;