-- Confirm the view columns match what you expect
SELECT column_name, data_type, ordinal_position
FROM   information_schema.columns
WHERE  table_schema = 'public'
  AND  table_name   = 'token_mint_public_view'
ORDER BY ordinal_position;