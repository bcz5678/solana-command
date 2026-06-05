CREATE OR REPLACE FUNCTION public.update_token_draft(
  p_mint_id              uuid,
  p_token_name           text      DEFAULT NULL,
  p_token_symbol         text      DEFAULT NULL,
  p_description          text      DEFAULT NULL,
  p_logo_url             text      DEFAULT NULL,
  p_banner_url           text      DEFAULT NULL,   -- ← added
  p_website_url          text      DEFAULT NULL,
  p_twitter_url          text      DEFAULT NULL,
  p_telegram_handle      text      DEFAULT NULL,
  p_tiktok_url           text      DEFAULT NULL,
  p_instagram_url        text      DEFAULT NULL,
  p_discord_url          text      DEFAULT NULL,
  p_communities_url      text      DEFAULT NULL,
  p_decimals             smallint  DEFAULT NULL,
  p_metadata_uri         text      DEFAULT NULL,
  p_max_supply           numeric   DEFAULT NULL,
  p_freeze_authority_key text      DEFAULT NULL,
  p_update_authority_key text      DEFAULT NULL,
  p_dev_wallet_id        uuid      DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = private, public
AS $$
DECLARE
  v_current private.token_mints%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;
 
  SELECT * INTO v_current
  FROM   private.token_mints
  WHERE  id = p_mint_id
  FOR UPDATE;
 
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Token mint % not found', p_mint_id;
  END IF;
 
  IF v_current.user_id != auth.uid()
    AND NOT (SELECT public.is_super_admin())
  THEN
    RAISE EXCEPTION 'Unauthorized: token not owned by caller';
  END IF;
 
  IF v_current.launch_status != 'draft' THEN
    RAISE EXCEPTION
      'Token % cannot be edited — current status: % (draft only)',
      p_mint_id, v_current.launch_status;
  END IF;
 
  IF p_dev_wallet_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.wallet_owners
      WHERE  wallet_id = p_dev_wallet_id
        AND  user_id   = auth.uid()
        AND  is_active = true
        AND  can_sign  = true
    ) THEN
      RAISE EXCEPTION 'Dev wallet % not found or not owned by caller',
        p_dev_wallet_id;
    END IF;
  END IF;
 
  -- Three-state: NULL keeps, value sets, '' clears (via NULLIF)
  UPDATE private.token_mints
  SET
    token_name           = COALESCE(p_token_name,           token_name),
    token_symbol         = COALESCE(p_token_symbol,         token_symbol),
    description          = COALESCE(p_description,          description),
    logo_url             = CASE WHEN p_logo_url        IS NULL THEN logo_url        ELSE NULLIF(p_logo_url,        '') END,
    banner_url           = CASE WHEN p_banner_url      IS NULL THEN banner_url      ELSE NULLIF(p_banner_url,      '') END,
    website_url          = CASE WHEN p_website_url      IS NULL THEN website_url     ELSE NULLIF(p_website_url,     '') END,
    twitter_url          = CASE WHEN p_twitter_url      IS NULL THEN twitter_url     ELSE NULLIF(p_twitter_url,     '') END,
    telegram_handle      = CASE WHEN p_telegram_handle  IS NULL THEN telegram_handle ELSE NULLIF(p_telegram_handle, '') END,
    tiktok_url           = CASE WHEN p_tiktok_url       IS NULL THEN tiktok_url      ELSE NULLIF(p_tiktok_url,      '') END,
    instagram_url        = CASE WHEN p_instagram_url    IS NULL THEN instagram_url   ELSE NULLIF(p_instagram_url,   '') END,
    discord_url          = CASE WHEN p_discord_url      IS NULL THEN discord_url     ELSE NULLIF(p_discord_url,     '') END,
    communities_url      = CASE WHEN p_communities_url  IS NULL THEN communities_url ELSE NULLIF(p_communities_url, '') END,
    decimals             = COALESCE(p_decimals,             decimals),
    metadata_uri         = COALESCE(p_metadata_uri,         metadata_uri),
    max_supply           = COALESCE(p_max_supply,           max_supply),
    freeze_authority_key = COALESCE(p_freeze_authority_key, freeze_authority_key),
    update_authority_key = COALESCE(p_update_authority_key, update_authority_key),
    dev_wallet_id        = COALESCE(p_dev_wallet_id,        dev_wallet_id),
    updated_at           = now()
  WHERE id = p_mint_id;
 
  INSERT INTO private.audit_logs (user_id, action, record_id, metadata)
  VALUES (
    auth.uid(),
    'token_draft_updated',
    p_mint_id,
    jsonb_strip_nulls(jsonb_build_object(
      'token_name',      p_token_name,
      'token_symbol',    p_token_symbol,
      'description',     p_description,
      'logo_url',        p_logo_url,
      'banner_url',      p_banner_url,
      'website_url',     p_website_url,
      'twitter_url',     p_twitter_url,
      'telegram_handle', p_telegram_handle,
      'tiktok_url',      p_tiktok_url,
      'instagram_url',   p_instagram_url,
      'discord_url',     p_discord_url,
      'communities_url', p_communities_url,
      'decimals',        p_decimals,
      'metadata_uri',    p_metadata_uri,
      'max_supply',      p_max_supply,
      'dev_wallet_id',   p_dev_wallet_id
    ))
  );
 
  RETURN jsonb_build_object(
    'mint_id',         p_mint_id,
    'token_name',      COALESCE(p_token_name,   v_current.token_name),
    'token_symbol',    COALESCE(p_token_symbol, v_current.token_symbol),
    'launch_status',   v_current.launch_status,
    'mint_public_key', v_current.mint_public_key,
    'updated_at',      now()
  );
END;
$$;
 
REVOKE ALL    ON FUNCTION public.update_token_draft(uuid,text,text,text,text,text,text,text,text,text,text,text,text,smallint,text,numeric,text,text,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.update_token_draft(uuid,text,text,text,text,text,text,text,text,text,text,text,text,smallint,text,numeric,text,text,uuid) TO authenticated;