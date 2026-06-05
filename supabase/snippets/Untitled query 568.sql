SELECT column_name, data_type
FROM   information_schema.columns
WHERE  table_schema = 'private'
  AND  table_name   = 'token_mints'
  AND  column_name  = 'banner_url';