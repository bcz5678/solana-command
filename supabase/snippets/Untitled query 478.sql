-- Drop and recreate to add description column
DROP VIEW IF EXISTS public.wallet_public_view;

CREATE VIEW public.wallet_public_view
WITH (security_invoker = true)
AS
  SELECT
    id,
    user_id,
    public_key,
    label,
    description,        -- ← added
    chain,
    is_active,
    created_at
    -- vault_secret_name intentionally excluded
  FROM private.wallets;

REVOKE ALL   ON public.wallet_public_view FROM PUBLIC;
REVOKE ALL   ON public.wallet_public_view FROM anon;
GRANT SELECT ON public.wallet_public_view TO authenticated;