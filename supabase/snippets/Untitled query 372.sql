SELECT
  id,
  raw_app_meta_data -> 'role' AS role_claim
FROM auth.users
WHERE id = '86db7fd5-e7ea-4361-9249-bf3f349de2ee';