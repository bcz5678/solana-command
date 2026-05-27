SELECT
  n.nspname                             AS schema,
  p.proname                             AS function_name,
  pg_get_function_arguments(p.oid)      AS arguments,
  pg_get_function_result(p.oid)         AS return_type,
  CASE p.prosecdef
    WHEN true THEN 'SECURITY DEFINER'
    ELSE            'SECURITY INVOKER'
  END                                   AS security,
  CASE p.provolatile
    WHEN 'i' THEN 'IMMUTABLE'
    WHEN 's' THEN 'STABLE'
    WHEN 'v' THEN 'VOLATILE'
  END                                   AS volatility,
  l.lanname                             AS language,
  r.rolname                             AS owner
FROM      pg_proc        p
JOIN      pg_namespace   n ON n.oid = p.pronamespace
JOIN      pg_language    l ON l.oid = p.prolang
JOIN      pg_roles       r ON r.oid = p.proowner
WHERE     n.nspname IN ('public', 'private')
  AND     p.prokind  = 'f'
ORDER BY  n.nspname, p.proname;