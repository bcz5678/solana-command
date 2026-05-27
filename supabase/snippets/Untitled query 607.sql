CREATE OR REPLACE FUNCTION public.get_my_wallets()
RETURNS TABLE (
  wallet_id         uuid,
  public_key        text,
  wallet_label      text,
  chain             text,
  is_active         boolean,
  owner_record_id   uuid,
  role              text,
  can_sign          boolean,
  can_view          boolean,
  can_share         boolean,
  granted_at        timestamptz,
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
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  RETURN QUERY
    SELECT
      w.id                AS wallet_id,
      w.public_key,
      wo.label            AS wallet_label,
      w.chain,
      w.is_active,
      wo.id               AS owner_record_id,
      wo.role,
      wo.can_sign,
      wo.can_view,
      wo.can_share,
      wo.granted_at,
      wt.id               AS wallet_type_id,
      wt.name             AS wallet_type,
      wg.id               AS wallet_group_id,
      wg.name             AS group_name,
      wg.color            AS group_color
    FROM   public.wallet_owners   wo
    JOIN   private.wallets        w   ON w.id  = wo.wallet_id
    LEFT   JOIN public.wallet_types   wt  ON wt.id = wo.wallet_type_id
    LEFT   JOIN public.wallet_groups  wg  ON wg.id = wo.group_id
    WHERE  wo.user_id    = auth.uid()
      AND  wo.is_active  = true
      AND  wo.revoked_at IS NULL
    ORDER BY wg.name NULLS LAST, w.created_at DESC;
END;
$$;

REVOKE ALL    ON FUNCTION public.get_my_wallets() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_my_wallets() TO authenticated;