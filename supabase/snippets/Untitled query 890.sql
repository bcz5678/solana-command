SELECT pg_get_function_result(p.oid) AS return_type
FROM   pg_proc      p
JOIN   pg_namespace n ON n.oid = p.pronamespace
WHERE  n.nspname = 'public'
  AND  p.proname = 'get_wallets';