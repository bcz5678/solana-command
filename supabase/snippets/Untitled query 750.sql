-- Add lifecycle status to token_mints
ALTER TABLE private.token_mints
  ADD COLUMN IF NOT EXISTS launch_status text NOT NULL DEFAULT 'draft'
    CHECK (launch_status IN ('draft', 'ready', 'launching', 'launched', 'failed'));

-- Add dev wallet reference
ALTER TABLE private.token_mints
  ADD COLUMN IF NOT EXISTS dev_wallet_id uuid
    REFERENCES private.wallets(id) ON DELETE SET NULL;

-- Add vanity keypair reference
ALTER TABLE private.token_mints
  ADD COLUMN IF NOT EXISTS vanity_keypair_id uuid
    REFERENCES private.vanity_keypairs(id) ON DELETE SET NULL;

-- Index for draft tokens
CREATE INDEX IF NOT EXISTS idx_token_mints_draft
  ON private.token_mints (launch_status, user_id)
  WHERE launch_status = 'draft';