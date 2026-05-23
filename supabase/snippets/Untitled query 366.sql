-- ============================================================
-- Wrapper: check if a vault secret name already exists
-- Same pattern as store_vault_secret — vault schema not exposed
-- ============================================================
CREATE OR REPLACE FUNCTION public.check_vault_secret_exists(
  p_name text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = vault, public
AS $$
BEGIN
  IF auth.role() != 'service_role' THEN
    RAISE EXCEPTION 'Unauthorized: vault access requires service_role';
  END IF;

  RETURN EXISTS (
    SELECT 1 FROM vault.secrets
    WHERE  name = p_name
  );
END;
$$;

-- Service role only
REVOKE ALL ON FUNCTION public.check_vault_secret_exists(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.check_vault_secret_exists(text) FROM anon;
REVOKE ALL ON FUNCTION public.check_vault_secret_exists(text) FROM authenticated;