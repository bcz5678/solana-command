 CREATE OR REPLACE VIEW public.token_mint_public_view
WITH (security_invoker = true)
AS
  SELECT
    id,
    user_id,
    mint_public_key,
    token_name,
    token_symbol,
    decimals,
    token_type,
    current_supply,
    max_supply,
    metadata_uri,
    is_active,
    authority_revoked,
    freeze_revoked,
    created_at,
    updated_at,
	-- ✅ New columns added here
	token_description,
	website_url,
	twitter_url,
	telegram_handle,
	launched,
	owner_id
	-- vault_secret_name still excluded — never add this
  FROM private.token_mints;