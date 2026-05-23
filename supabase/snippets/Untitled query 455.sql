-- Makes imported_by nullable — consistent with vanity_keypairs
-- and defensive against any future service_role calls without a user context
ALTER TABLE private.vanity_import_batches
  ALTER COLUMN imported_by DROP NOT NULL;