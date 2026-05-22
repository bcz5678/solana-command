
-- ===========================================================
-- SECTION 8: WALLET SECURITY DEFINER FUNCTIONS
-- (Controlled bridges from private schema → client)
-- ===========================================================
 
-- ── create_wallet() ─────────────────────────────────────────
-- Atomically creates wallet + recovery record.
-- Accepts encrypted seed (ciphertext) — never the plaintext mnemonic.
-- Called from client after client-side encryption.
CREATE OR REPLACE FUNCTION public.create_wallet(
  p_public_key     text,
  p_label          text,
  p_chain          text,
  p_encrypted_seed text,
  p_iv             text,
  p_salt           text,
  p_kdf_iterations integer DEFAULT 600000
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = private, public
AS $$
DECLARE
  v_wallet_id uuid;
BEGIN
  -- Reject unauthenticated calls
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;
 
  -- Insert wallet (public key + vault pointer only)
  INSERT INTO private.wallets (user_id, public_key, label, chain)
  VALUES (auth.uid(), p_public_key, p_label, p_chain)
  RETURNING id INTO v_wallet_id;
 
  -- Insert client-encrypted recovery blob
  -- Server stores ciphertext only — cannot decrypt without user's password
  INSERT INTO private.wallet_recovery (
    wallet_id, user_id,
    encrypted_seed, iv, salt, kdf_iterations
  )
  VALUES (
    v_wallet_id, auth.uid(),
    p_encrypted_seed, p_iv, p_salt, p_kdf_iterations
  );
 
  -- Audit log
  INSERT INTO private.audit_logs (user_id, action, record_id, metadata)
  VALUES (auth.uid(), 'wallet_created', v_wallet_id,
    jsonb_build_object('chain', p_chain, 'public_key', p_public_key));
 
  RETURN jsonb_build_object('wallet_id', v_wallet_id);
END;
$$;
 
REVOKE ALL   ON FUNCTION public.create_wallet(text,text,text,text,text,text,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_wallet(text,text,text,text,text,text,integer) TO authenticated;
 
 
-- ── get_wallets() ────────────────────────────────────────────
-- Returns wallet records with public-safe columns only.
-- vault_secret_name is ALWAYS excluded.
-- Regular users: own wallets only.
-- Super admins: all wallets, optionally filtered by user.
CREATE OR REPLACE FUNCTION public.get_wallets(
  target_user_id uuid DEFAULT NULL   -- NULL = all (super admin only)
)
RETURNS TABLE (
  id          uuid,
  user_id     uuid,
  public_key  text,
  label       text,
  chain       text,
  is_active   boolean,
  created_at  timestamptz
  -- vault_secret_name intentionally excluded from all return paths
)
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = private, public
AS $$
BEGIN
  -- Super admin path: can view any user's wallets
  IF (SELECT public.is_super_admin()) THEN
    RETURN QUERY
      SELECT w.id, w.user_id, w.public_key, w.label,
             w.chain, w.is_active, w.created_at
      FROM   private.wallets w
      WHERE  (target_user_id IS NULL OR w.user_id = target_user_id)
      ORDER BY w.created_at DESC;
 
  -- Authenticated user: own wallets only, target_user_id ignored
  ELSIF auth.uid() IS NOT NULL THEN
    RETURN QUERY
      SELECT w.id, w.user_id, w.public_key, w.label,
             w.chain, w.is_active, w.created_at
      FROM   private.wallets w
      WHERE  w.user_id = auth.uid()   -- hard-scoped, not overridable
      ORDER BY w.created_at DESC;
 
  -- Unauthenticated — return nothing
  ELSE
    RETURN;
  END IF;
END;
$$;
 
REVOKE ALL   ON FUNCTION public.get_wallets(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_wallets(uuid) TO authenticated;
 
 
-- ── get_wallet_recovery() ────────────────────────────────────
-- Returns the encrypted seed blob so the CLIENT can decrypt it.
-- Server never decrypts — only returns ciphertext + KDF params.
-- Users can only fetch their own recovery data.
-- Super admins can fetch any wallet's recovery data.
CREATE OR REPLACE FUNCTION public.get_wallet_recovery(
  p_wallet_id uuid
)
RETURNS TABLE (
  encrypted_seed  text,
  iv              text,
  salt            text,
  kdf             text,
  kdf_iterations  integer,
  enc_algorithm   text
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
      wr.encrypted_seed,
      wr.iv,
      wr.salt,
      wr.kdf,
      wr.kdf_iterations,
      wr.enc_algorithm
    FROM private.wallet_recovery wr
    JOIN private.wallets w ON w.id = wr.wallet_id
    WHERE wr.wallet_id = p_wallet_id
      AND (
        w.user_id = auth.uid()              -- owner
        OR (SELECT public.is_super_admin()) -- or super admin
      );
END;
$$;
 
REVOKE ALL   ON FUNCTION public.get_wallet_recovery(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_wallet_recovery(uuid) TO authenticated;
 
 
-- ── get_vault_secret() ───────────────────────────────────────
-- Fetches a decrypted secret from Supabase Vault.
-- ONLY callable by service_role (Edge Functions / bot).
-- Authenticated users cannot call this — ever.
CREATE OR REPLACE FUNCTION private.get_vault_secret(secret_name text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = vault, private, public
AS $$
DECLARE
  v_secret text;
BEGIN
  -- Reject any call not made under service_role
  -- auth.role() returns 'service_role' only for service key requests
  IF auth.role() != 'service_role' THEN
    RAISE EXCEPTION 'Unauthorized: vault access requires service_role';
  END IF;
 
  SELECT decrypted_secret INTO v_secret
  FROM   vault.decrypted_secrets
  WHERE  name = secret_name;
 
  IF v_secret IS NULL THEN
    RAISE EXCEPTION 'Secret not found: %', secret_name;
  END IF;
 
  RETURN v_secret;
END;
$$;
 
-- No user role can call this — postgres and service_role only
REVOKE ALL ON FUNCTION private.get_vault_secret(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION private.get_vault_secret(text) FROM authenticated;
REVOKE ALL ON FUNCTION private.get_vault_secret(text) FROM anon;
 
