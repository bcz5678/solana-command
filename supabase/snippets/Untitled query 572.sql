
CREATE OR REPLACE FUNCTION public.get_wallets(
  target_user_id uuid DEFAULT NULL
)
RETURNS TABLE (
  id                uuid,
  user_id           uuid,
  public_key        text,
  label             text,
  chain             text,
  is_active         boolean,
  created_at        timestamptz,
  owner_record_id   uuid,
  role              text,
  wallet_type_id    uuid,
  wallet_type       text,
  wallet_group_id   uuid,
  group_name        text,
  group_color       text
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
        w.id,
        w.user_id,
        w.public_key,
        COALESCE(wo.label, w.label)   AS label,
        w.chain,
        w.is_active,
        w.created_at,
        wo.id               AS owner_record_id,
        wo.role,
        wt.id               AS wallet_type_id,
        wt.name             AS wallet_type,
        wg.id               AS wallet_group_id,
        wg.name             AS group_name,
        wg.color            AS group_color
      FROM   private.wallets        w
      LEFT   JOIN public.wallet_owners  wo  ON wo.wallet_id = w.id
                                           AND wo.is_active = true
      LEFT   JOIN public.wallet_types   wt  ON wt.id = wo.wallet_type_id
      LEFT   JOIN public.wallet_groups  wg  ON wg.id = wo.group_id
      WHERE  (target_user_id IS NULL OR w.user_id = target_user_id)
      ORDER BY w.created_at DESC;

  ELSIF auth.uid() IS NOT NULL THEN
    RETURN QUERY
      SELECT
        w.id,
        w.user_id,
        w.public_key,
        COALESCE(wo.label, w.label)   AS label,
        w.chain,
        w.is_active,
        w.created_at,
        wo.id               AS owner_record_id,
        wo.role,
        wt.id               AS wallet_type_id,
        wt.name             AS wallet_type,
        wg.id               AS wallet_group_id,
        wg.name             AS group_name,
        wg.color            AS group_color
      FROM   private.wallets        w
      LEFT   JOIN public.wallet_owners  wo  ON wo.wallet_id = w.id
                                           AND wo.user_id   = auth.uid()
                                           AND wo.is_active = true
      LEFT   JOIN public.wallet_types   wt  ON wt.id = wo.wallet_type_id
      LEFT   JOIN public.wallet_groups  wg  ON wg.id = wo.group_id
      WHERE  w.user_id = auth.uid()
      ORDER BY w.created_at DESC;

  ELSE
    RETURN;
  END IF;
END;
$$;

REVOKE ALL    ON FUNCTION public.get_wallets(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_wallets(uuid) TO authenticated;