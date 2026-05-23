  -- ✅ Option A: CREATE OR REPLACE (adding to end — no drop needed)
CREATE OR REPLACE VIEW public.wallet_public_view
WITH (security_invoker = true)
AS
  SELECT
    id,
    user_id,
    public_key,
    label,
    chain,
    is_active,
    created_at,
    -- ✅ New columns added here
    funded,
	wallet_type_id,
	wallet_owners_id,
	wallet_groups_id,
	token_holdings,
	solana_balance_in_lamports
    -- vault_secret_name still excluded — never add this
  FROM private.wallets;