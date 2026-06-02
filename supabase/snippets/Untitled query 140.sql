SELECT column_name, data_type
FROM   information_schema.columns
WHERE  table_schema = 'private'
  AND  table_name   = 'token_mints'
  AND  column_name  IN (
    'website_url', 'twitter_url', 'telegram_handle',
    'tiktok_url', 'instagram_url', 'discord_url', 'communities_url'
  )
ORDER BY column_name;