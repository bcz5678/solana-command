REVOKE ALL   ON public.token_mint_public_view FROM PUBLIC;
REVOKE ALL   ON public.token_mint_public_view FROM anon;
GRANT SELECT ON public.token_mint_public_view TO authenticated;