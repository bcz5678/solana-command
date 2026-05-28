ALTER TABLE private.token_mints
  ADD COLUMN IF NOT EXISTS chain text NOT NULL DEFAULT 'solana';