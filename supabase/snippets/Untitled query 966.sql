-- Lists all functions in private schema
-- Cross-reference these against your .rpc() calls in TypeScript
SELECT
  p.proname                         AS function_name,
  pg_get_function_arguments(p.oid)  AS arguments
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
ORDER BY p.proname;