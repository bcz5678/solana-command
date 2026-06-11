SELECT pg_get_function_arguments(p.oid) AS arguments
FROM   pg_proc      p
JOIN   pg_namespace n ON n.oid = p.pronamespace
WHERE  n.nspname = 'public'
  AND  p.proname = 'create_wallet_group';