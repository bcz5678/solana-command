DROP VIEW IF EXISTS public.token_mint_public_view;

CREATE VIEW public.token_mint_public_view
WITH (security_invoker = true)
AS
  SELECT
    id,
    user_id,
    mint_public_key,
    token_name,
    token_symbol,
    description,          -- ← added
    decimals,
    token_type,
    current_supply,
    max_supply,
    metadata_uri,
    is_active,
    authority_revoked,
    freeze_revoked,
    created_at,
    updated_at
    -- vault_secret_name intentionally excluded
  FROM private.token_mints;

REVOKE ALL   ON public.token_mint_public_view FROM PUBLIC;
REVOKE ALL   ON public.token_mint_public_view FROM anon;
GRANT SELECT ON public.token_mint_public_view TO authenticated;