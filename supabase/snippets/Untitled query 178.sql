-- Confirm the wrapper is callable and returns a uuid
-- Run as service_role in SQL editor
SELECT public.store_vault_secret(
  '[1,2,3,4,5,6,7,8]',
  'test_vanity_secret',
  'Test entry — delete after verification'
);
-- Expected: a uuid like 'a1b2c3d4-...'

-- Confirm it landed in vault (metadata only — not the secret value)
SELECT id, name, description, created_at
FROM   vault.secrets
WHERE  name = 'test_vanity_secret';

-- Clean up test entry
DELETE FROM vault.secrets WHERE name = 'test_vanity_secret';