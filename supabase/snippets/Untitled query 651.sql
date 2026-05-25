-- Grant authenticated role execute on both helper functions
-- They are SECURITY DEFINER so they run as the function owner (postgres),
-- but the calling role still needs EXECUTE permission to invoke them

GRANT EXECUTE ON FUNCTION private.user_owns_wallet(uuid, uuid)     TO authenticated;
GRANT EXECUTE ON FUNCTION private.user_can_share_wallet(uuid, uuid) TO authenticated;