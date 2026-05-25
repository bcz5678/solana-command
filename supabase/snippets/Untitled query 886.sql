-- Drop the existing version first
DROP FUNCTION IF EXISTS public.create_wallet(text,text,text,text,text,text,integer);

-- Recreate with vault_secret_name added
CREATE OR REPLACE FUNCTION public.create_wallet(
  p_public_key          text,
  p_label               text,
  p_chain               text,
  p_encrypted_seed      text,
  p_iv                  text,
  p_salt                text,
  p_vault_secret_name   text,                    -- ← added
  p_kdf_iterations      integer DEFAULT 600000
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = private, public
AS $$
DECLARE
  v_wallet_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  INSERT INTO private.wallets (
    user_id,
    public_key,
    label,
    chain,
    vault_secret_name          -- ← now populated
  )
  VALUES (
    auth.uid(),
    p_public_key,
    p_label,
    p_chain,
    p_vault_secret_name
  )
  RETURNING id INTO v_wallet_id;

  INSERT INTO private.wallet_recovery (
    wallet_id, user_id,
    encrypted_seed, iv, salt, kdf_iterations
  )
  VALUES (
    v_wallet_id, auth.uid(),
    p_encrypted_seed, p_iv, p_salt, p_kdf_iterations
  );

  INSERT INTO private.audit_logs (user_id, action, record_id, metadata)
  VALUES (
    auth.uid(),
    'wallet_created',
    v_wallet_id,
    jsonb_build_object(
      'chain',      p_chain,
      'public_key', p_public_key,
      'custodial',  p_vault_secret_name IS NOT NULL
    )
  );

  RETURN jsonb_build_object('wallet_id', v_wallet_id);
END;
$$;

-- Reapply grants after drop
REVOKE ALL    ON FUNCTION public.create_wallet(text,text,text,text,text,text,text,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_wallet(text,text,text,text,text,text,text,integer) TO authenticated;