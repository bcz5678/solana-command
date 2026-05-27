-- ============================================================
-- Public wrapper for private.claim_vanity_keypair
-- ============================================================
CREATE OR REPLACE FUNCTION public.claim_vanity_keypair(
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
BEGIN
  -- Super admin only
  IF NOT (SELECT public.is_super_admin()) THEN
    RAISE EXCEPTION 'Unauthorized: super admin required';
  END IF;

  RETURN QUERY
    SELECT *
    FROM private.claim_vanity_keypair(
      p_chain,
      p_vanity_prefix,
      p_mint_id,
      p_claimed_by
    );
END;
$$;

REVOKE ALL    ON FUNCTION public.claim_vanity_keypair(text,text,uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.claim_vanity_keypair(text,text,uuid,uuid) TO authenticated;