-- 6. Update import_vanity_keypairs() — input is now secretKey only
--    Public key is derived inside the function, not passed in
CREATE OR REPLACE FUNCTION private.import_vanity_keypairs(
  p_keypairs    jsonb,     -- array of {vault_secret_name, public_key}
                           -- public_key was derived in Edge Fn from secretKey
                           -- secretKey itself never appears here
  p_chain       text,
  p_filename    text,
  p_imported_by uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = private, public
AS $$
DECLARE
  v_batch_id    uuid;
  v_keypair     jsonb;
  v_count       integer := 0;
  v_skipped     integer := 0;
  v_pub_key     text;
  v_vault_name  text;
BEGIN
  IF auth.role() != 'service_role' THEN
    RAISE EXCEPTION 'Unauthorized: import requires service_role';
  END IF;

  IF jsonb_typeof(p_keypairs) != 'array' OR jsonb_array_length(p_keypairs) = 0 THEN
    RAISE EXCEPTION 'p_keypairs must be a non-empty JSON array';
  END IF;

  INSERT INTO private.vanity_import_batches (
    id, imported_by, filename, keypair_count, chain
  )
  VALUES (
    gen_random_uuid(), p_imported_by,
    p_filename, jsonb_array_length(p_keypairs), p_chain
  )
  RETURNING id INTO v_batch_id;

  FOR v_keypair IN SELECT * FROM jsonb_array_elements(p_keypairs)
  LOOP
    v_pub_key    := v_keypair ->> 'public_key';
    v_vault_name := v_keypair ->> 'vault_secret_name';

    -- DB-level suffix guard — double check before insert
    -- The CHECK constraint will also catch this, but explicit error
    -- message is more useful than a constraint violation
    IF lower(right(v_pub_key, 4)) != 'pump' THEN
      RAISE EXCEPTION
        'Keypair does not end with pump suffix: % — import aborted',
        v_pub_key;
    END IF;

    INSERT INTO private.vanity_keypairs (
      public_key,
      vault_secret_name,
      vanity_suffix,
      chain,
      import_batch_id,
      imported_by,
      pubkey_derived
    )
    VALUES (
      v_pub_key,
      v_vault_name,
      'pump',           -- hardcoded constant — not user input
      p_chain,
      v_batch_id,
      p_imported_by,
      true              -- derived from secret in Edge Function
    )
    ON CONFLICT (public_key) DO NOTHING;

    IF FOUND THEN
      v_count   := v_count + 1;
    ELSE
      v_skipped := v_skipped + 1;
    END IF;
  END LOOP;

  INSERT INTO private.audit_logs (user_id, action, record_id, metadata)
  VALUES (
    p_imported_by,
    'vanity_keypairs_imported',
    v_batch_id,
    jsonb_build_object(
      'batch_id',       v_batch_id,
      'filename',       p_filename,
      'imported_count', v_count,
      'skipped_count',  v_skipped,
      'vanity_suffix',  'pump',
      'chain',          p_chain
    )
  );

  RETURN jsonb_build_object(
    'batch_id',       v_batch_id,
    'imported_count', v_count,
    'skipped_count',  v_skipped
  );
END;
$$;