-- ============================================================
-- PATCH: Fix one_default_group_per_user constraint
-- ============================================================

-- 1. Drop the broken table constraint
ALTER TABLE public.wallet_groups
  DROP CONSTRAINT IF EXISTS one_default_group_per_user;

-- 2. Replace with partial unique index — only enforces uniqueness
--    when is_default = true, ignores all false rows entirely
CREATE UNIQUE INDEX IF NOT EXISTS idx_one_default_group_per_user
  ON public.wallet_groups (user_id)
  WHERE is_default = true;

-- 3. Update create_wallet_group() to rely on the index
--    instead of manual unsetting (the index handles enforcement,
--    but we still unset the old default for data cleanliness)
CREATE OR REPLACE FUNCTION public.create_wallet_group(
  p_name        text,
  p_description text    DEFAULT NULL,
  p_color       text    DEFAULT NULL,
  p_icon        text    DEFAULT NULL,
  p_is_default  boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = private, public
AS $$
DECLARE
  v_group_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  -- If new group is default, demote the existing default first.
  -- The partial index would catch a duplicate anyway, but unsetting
  -- first gives a clean transition with no constraint race.
  IF p_is_default = true THEN
    UPDATE public.wallet_groups
    SET    is_default = false,
           updated_at = now()
    WHERE  user_id    = auth.uid()
      AND  is_default = true;
  END IF;

  INSERT INTO public.wallet_groups (
    user_id, name, description, color, icon, is_default
  )
  VALUES (
    auth.uid(), p_name, p_description, p_color, p_icon,
    COALESCE(p_is_default, false)    -- never insert NULL
  )
  RETURNING id INTO v_group_id;

  RETURN jsonb_build_object('group_id', v_group_id);
END;
$$;

REVOKE ALL    ON FUNCTION public.create_wallet_group(text,text,text,text,boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_wallet_group(text,text,text,text,boolean) TO authenticated;