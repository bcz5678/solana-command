-- ============================================================
-- Public wrapper for private.import_vanity_keypairs
-- Bridges the private schema gap for PostgREST / supabase.rpc()
-- ============================================================
CREATE OR REPLACE FUNCTION public.import_vanity_keypairs(
  p_keypairs    jsonb,
  p_chain       text,
  p_filename    text,
  p_imported_by uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = private, public
AS $$
BEGIN
  -- Service role only — import is a privileged operation
  IF auth.role() != 'service_role' THEN
    RAISE EXCEPTION 'Unauthorized: import requires service_role';
  END IF;

  RETURN private.import_vanity_keypairs(
    p_keypairs,
    p_chain,
    p_filename,
    p_imported_by
  );
END;
$$;

-- Service role only — no user access
REVOKE ALL ON FUNCTION public.import_vanity_keypairs(jsonb,text,text,uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.import_vanity_keypairs(jsonb,text,text,uuid) FROM anon;
REVOKE ALL ON FUNCTION public.import_vanity_keypairs(jsonb,text,text,uuid) FROM authenticated;