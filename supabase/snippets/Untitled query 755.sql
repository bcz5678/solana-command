CREATE OR REPLACE FUNCTION public.store_vault_secret(
  p_secret      text,
  p_name        text,
  p_description text DEFAULT ''
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = vault, public
AS $$
DECLARE
  v_id uuid;
BEGIN
  IF auth.role() != 'service_role' THEN
    RAISE EXCEPTION 'Unauthorized: vault access requires service_role';
  END IF;

  -- Matches exact signature from vault.create_secret
  SELECT vault.create_secret(
    p_secret,       -- new_secret
    p_name,         -- new_name
    p_description   -- new_description
                    -- new_key_id left as DEFAULT NULL (uses Supabase default key)
  ) INTO v_id;

  IF v_id IS NULL THEN
    RAISE EXCEPTION 'vault.create_secret returned NULL for name: %', p_name;
  END IF;

  RETURN v_id;
END;
$$;

-- Lock down — service_role only, no user access
REVOKE ALL ON FUNCTION public.store_vault_secret(text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.store_vault_secret(text, text, text) FROM anon;
REVOKE ALL ON FUNCTION public.store_vault_secret(text, text, text) FROM authenticated;
