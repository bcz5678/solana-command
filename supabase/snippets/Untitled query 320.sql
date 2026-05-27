ALTER TABLE private.token_mints
  ADD COLUMN IF NOT EXISTS description text;