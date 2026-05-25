-- Confirm no policies reference wallet_owners directly in their body
SELECT
  policyname,
  cmd,
  qual,
  with_check
FROM pg_policies
WHERE tablename  = 'wallet_owners'
  AND schemaname = 'public';

-- Test insert works without recursion
-- (run as authenticated user in SQL editor)
SET LOCAL "request.jwt.claims" TO
  '{"sub":"86db7fd5-e7ea-4361-9249-bf3f349de2ee","app_metadata":{"role":"user"}}';

INSERT INTO public.wallet_owners (
  wallet_id, user_id, role, can_sign, can_view, can_share, label
)
VALUES (
  '23334972-9d11-43a1-881a-4b8b3ce805cd',
  '86db7fd5-e7ea-4361-9249-bf3f349de2ee',
  'sole', true, true, false, 'test'
);

RESET ROLE;