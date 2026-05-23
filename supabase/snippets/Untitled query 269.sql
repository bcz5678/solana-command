-- ⚠️ Deletes ALL vanity keypairs including ones attached to mints
-- Only run this in dev/reset scenarios
-- used keypairs are still referenced by private.token_mints

DO $$
DECLARE
  v_row     record;
  v_deleted integer := 0;
BEGIN

  -- Detach from mints first (set to NULL so FK doesn't block)
  -- Only if token_mints references vanity_keypairs
  -- UPDATE private.token_mints SET vanity_keypair_id = NULL;

  FOR v_row IN
    SELECT id, vault_secret_name
    FROM   private.vanity_keypairs
  LOOP
    DELETE FROM vault.secrets
    WHERE  name = v_row.vault_secret_name;

    DELETE FROM private.vanity_keypairs
    WHERE  id = v_row.id;

    v_deleted := v_deleted + 1;
  END LOOP;

  -- Clear import batch records too
  DELETE FROM private.vanity_import_batches;

  RAISE NOTICE 'Cleared % keypairs from vault and staging table', v_deleted;
END;
$$;