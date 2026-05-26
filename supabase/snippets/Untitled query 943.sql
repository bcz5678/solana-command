-- ── Full source of any public function ───────────────────────
SELECT
  n.nspname                         AS schema,
  p.proname                         AS function_name,
  pg_get_function_arguments(p.oid)  AS arguments,
  pg_get_function_result(p.oid)     AS return_type,
  p.prosrc                          AS source_body
FROM   pg_proc       p
JOIN   pg_namespace  n ON n.oid = p.pronamespace
WHERE  n.nspname = 'public'
  AND  p.proname = 'get_wallet_recovery';

-- ── See ALL function bodies in public + private ───────────────
SELECT
  n.nspname                         AS schema,
  p.proname                         AS function_name,
  pg_get_function_arguments(p.oid)  AS arguments,
  p.prosrc                          AS source_body
FROM   pg_proc       p
JOIN   pg_namespace  n ON n.oid = p.pronamespace
WHERE  n.nspname IN ('public', 'private')
  AND  p.prokind = 'f'
ORDER BY n.nspname, p.proname;

-- ── Find which functions call other functions ─────────────────
-- Shows dependency chain: what does public.X call internally
SELECT DISTINCT
  n_caller.nspname   AS caller_schema,
  p_caller.proname   AS caller_function,
  n_dep.nspname      AS calls_schema,
  p_dep.proname      AS calls_function
FROM   pg_proc          p_caller
JOIN   pg_namespace     n_caller ON n_caller.oid = p_caller.pronamespace
JOIN   pg_depend        d        ON d.objid       = p_caller.oid
JOIN   pg_proc          p_dep    ON p_dep.oid     = d.refobjid
JOIN   pg_namespace     n_dep    ON n_dep.oid     = p_dep.pronamespace
WHERE  n_caller.nspname IN ('public', 'private')
  AND  d.deptype = 'n'
ORDER BY caller_schema, caller_function;