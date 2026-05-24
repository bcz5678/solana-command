SELECT n.nspname AS schema, p.proname AS function_name,
       pg_get_function_arguments(p.oid) AS arguments
FROM   pg_proc p
JOIN   pg_namespace n ON n.oid = p.pronamespace
WHERE  n.nspname IN ('public', 'private')
  AND  p.prokind  = 'f'
  AND  p.prosecdef = true
ORDER BY n.nspname, p.proname;