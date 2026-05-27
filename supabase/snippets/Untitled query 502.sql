SELECT column_name
FROM   information_schema.columns
WHERE  table_schema = 'private'
  AND  table_name   = 'wallets'
  AND  column_name  = 'description';