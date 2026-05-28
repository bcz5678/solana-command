SELECT column_name, data_type
FROM   information_schema.columns
WHERE  table_schema = 'private'
  AND  table_name   = 'vanity_keypairs'
ORDER BY ordinal_position;