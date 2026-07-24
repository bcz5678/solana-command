-- get_token_mint_id_by_pubkey()
-- Resolves a mint's on-chain public key back to its private.token_mints.id,
-- so trade-logging code (lib/trades/log.ts) can populate trade_logs.mint_id
-- for tokens that were launched through this platform.
--
-- service_role only — called from server-side code via the admin client,
-- same gating as get_vault_secret(). Never exposed to authenticated/anon,
-- since it's an internal FK-resolution helper, not user-facing data.
--
-- Run this in the Supabase SQL editor (Studio) to create/update the function.

CREATE OR REPLACE FUNCTION public.get_token_mint_id_by_pubkey(
  p_mint_public_key text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = private, public
AS $$
DECLARE
  v_id uuid;
BEGIN
  IF auth.role() != 'service_role' THEN
    RAISE EXCEPTION 'Unauthorized: requires service_role';
  END IF;

  SELECT id INTO v_id
  FROM private.token_mints
  WHERE mint_public_key = p_mint_public_key
  LIMIT 1;

  RETURN v_id;   -- NULL when the mint was never launched through this platform
END;
$$;

REVOKE ALL ON FUNCTION public.get_token_mint_id_by_pubkey(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_token_mint_id_by_pubkey(text) FROM authenticated;
REVOKE ALL ON FUNCTION public.get_token_mint_id_by_pubkey(text) FROM anon;
