
DO $$
DECLARE
  v_row       record;
  v_deleted   integer := 0;
  v_failed    integer := 0;
BEGIN

  FOR v_row IN
    SELECT id, public_key, vault_secret_name, status
    FROM   private.vanity_keypairs
    WHERE  status = 'available'   -- only clear unassigned keypairs
  LOOP
    BEGIN
      -- 1. Delete from Vault first
      DELETE FROM vault.secrets
      WHERE  name = v_row.vault_secret_name;

      -- 2. Delete staging row
      DELETE FROM private.vanity_keypairs
      WHERE  id = v_row.id;

      v_deleted := v_deleted + 1;

    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'Failed to delete keypair % (vault: %): %',
        v_row.public_key,
        v_row.vault_secret_name,
        SQLERRM;
      v_failed := v_failed + 1;
    END;
  END LOOP;

  RAISE NOTICE 'Deleted: % | Failed: %', v_deleted, v_failed;
END;
$$;