-- Verify get_vault_secret reads from the right view
CREATE OR REPLACE FUNCTION private.get_vault_secret(secret_name text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = vault, private, public
AS $$
DECLARE
  v_secret text;
BEGIN
  IF auth.role() != 'service_role' THEN
    RAISE EXCEPTION 'Unauthorized: vault access requires service_role';
  END IF;

  -- vault.decrypted_secrets is the view that decrypts on read
  SELECT decrypted_secret INTO v_secret
  FROM   vault.decrypted_secrets      -- ← confirmed view name
  WHERE  name = secret_name;

  IF v_secret IS NULL THEN
    RAISE EXCEPTION 'Secret not found in vault: %', secret_name;
  END IF;

  RETURN v_secret;
END;
$$;