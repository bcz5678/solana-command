-- Find all vault-related functions available
SELECT
  n.nspname   AS schema,
  p.proname   AS function_name,
  pg_get_function_arguments(p.oid) AS arguments
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE p.proname ILIKE '%wallet%'
  OR  p.proname ILIKE '%vault%'
ORDER BY n.nspname, p.proname;