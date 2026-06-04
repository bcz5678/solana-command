SET LOCAL "request.jwt.claims" TO
  '{"sub":"86db7fd5-e7ea-4361-9249-bf3f349de2ee","app_metadata":{"role":"super_admin"}}';

SELECT * FROM public.claim_vanity_keypair('solana', NULL, NULL, NULL);

RESET ROLE;