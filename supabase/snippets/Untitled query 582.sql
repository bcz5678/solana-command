SELECT
  p.proname                         AS function_name,
  pg_get_function_arguments(p.oid)  AS arguments
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'private'
  AND p.proname = 'import_vanity_keypairs';