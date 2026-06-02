CREATE OR REPLACE FUNCTION public.get_token_mints(
  target_user_id uuid DEFAULT NULL
)
RETURNS TABLE (
  id                   uuid,
  user_id              uuid,
  mint_public_key      text,
  token_name           text,
  token_symbol         text,
  description          text,
  logo_url             text,
  tiktok_url           text,        -- ← added
  instagram_url        text,        -- ← added
  discord_url          text,        -- ← added
  communities_url      text,        -- ← added
  decimals             smallint,
  token_type           text,
  chain                text,
  launch_status        text,
  current_supply       numeric,
  max_supply           numeric,
  metadata_uri         text,
  is_active            boolean,
  authority_revoked    boolean,
  freeze_revoked       boolean,
  dev_wallet_id        uuid,
  vanity_keypair_id    uuid,
  created_at           timestamptz,
  updated_at           timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = private, public
AS $$
BEGIN
  IF (SELECT public.is_super_admin()) THEN
    RETURN QUERY
      SELECT
        tm.id, tm.user_id, tm.mint_public_key,
        tm.token_name, tm.token_symbol, tm.description,
        tm.logo_url,
        tm.tiktok_url, tm.instagram_url, tm.discord_url, tm.communities_url,
        tm.decimals, tm.token_type,
        tm.chain, tm.launch_status,
        tm.current_supply, tm.max_supply,
        tm.metadata_uri, tm.is_active,
        tm.authority_revoked, tm.freeze_revoked,
        tm.dev_wallet_id, tm.vanity_keypair_id,
        tm.created_at, tm.updated_at
      FROM private.token_mints tm
      WHERE (target_user_id IS NULL OR tm.user_id = target_user_id)
      ORDER BY tm.created_at DESC;
 
  ELSIF auth.uid() IS NOT NULL THEN
    RETURN QUERY
      SELECT
        tm.id, tm.user_id, tm.mint_public_key,
        tm.token_name, tm.token_symbol, tm.description,
        tm.logo_url,
        tm.tiktok_url, tm.instagram_url, tm.discord_url, tm.communities_url,
        tm.decimals, tm.token_type,
        tm.chain, tm.launch_status,
        tm.current_supply, tm.max_supply,
        tm.metadata_uri, tm.is_active,
        tm.authority_revoked, tm.freeze_revoked,
        tm.dev_wallet_id, tm.vanity_keypair_id,
        tm.created_at, tm.updated_at
      FROM private.token_mints tm
      WHERE tm.user_id = auth.uid()
      ORDER BY tm.created_at DESC;
 
  ELSE
    RETURN;
  END IF;
END;
$$;
 
REVOKE ALL    ON FUNCTION public.get_token_mints(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_token_mints(uuid) TO authenticated;
 