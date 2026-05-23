ALTER TABLE private.wallets
  ADD COLUMN IF NOT EXISTS funded  			bool DEFAULT FALSE, 
  ADD COLUMN IF NOT EXISTS wallet_type_id  	int8,
  ADD COLUMN IF NOT EXISTS wallet_owners_id int8,
  ADD COLUMN IF NOT EXISTS wallet_groups_id int8,
  ADD COLUMN IF NOT EXISTS token_holdings   jsonb,
  ADD COLUMN IF NOT EXISTS solana_balance_in_imports int8 DEFAULT 0;