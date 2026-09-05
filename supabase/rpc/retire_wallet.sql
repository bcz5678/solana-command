-- retire_wallet(): permanently marks a wallet unusable.
--
-- This is the ONLY thing this function does — it doesn't touch the chain,
-- doesn't check balances, doesn't close anything. The API route calling this
-- (app/api/wallets/retire/route.ts) is responsible for verifying the wallet
-- is actually empty (0 SOL, 0 token accounts) on-chain first, and only calls
-- this once that's confirmed.
--
-- The actual enforcement already exists: private.get_wallet_secret_by_id()
-- (see supabase/rpc/... wherever the vault RPCs live) already has
-- `AND is_active = true` in its WHERE clause, so the instant this runs, every
-- trade/transfer/comment route becomes physically unable to fetch this
-- wallet's signing key — regardless of what any UI still shows or caches.
-- This function just flips that flag through a proper SECURITY DEFINER path,
-- since private.wallets isn't PostgREST-exposed for a direct update.
--
-- Run this in the Supabase SQL editor (Studio) — same as every other RPC
-- file in this repo, no migrations directory here.
DROP FUNCTION IF EXISTS public.retire_wallet(uuid);

CREATE OR REPLACE FUNCTION public.retire_wallet(p_wallet_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = private, public
AS $$
BEGIN
  IF NOT (SELECT public.is_super_admin()) AND auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  UPDATE private.wallets
  SET is_active = false
  WHERE id = p_wallet_id
    AND (public.is_super_admin() OR user_id = auth.uid());

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Wallet not found or not owned by caller';
  END IF;
END;
$$;

REVOKE ALL    ON FUNCTION public.retire_wallet(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.retire_wallet(uuid) TO authenticated;
