-- ============================================================
-- Supabase Storage RLS Policies for: token-media bucket
-- Folder:  public/
-- ============================================================
-- Anon  → SELECT (read) only
-- Authenticated → INSERT, UPDATE, DELETE
-- ============================================================

-- 1. Allow ANYONE (anon + authenticated) to READ files in public/
CREATE POLICY "Public read access on token-media/public"
ON storage.objects
FOR SELECT
TO anon, authenticated          -- both roles can read
USING (
  bucket_id = 'token-media'
  AND (storage.foldername(name))[1] = 'public'  -- only the 'public/' folder
);

-- 2. Allow authenticated users to UPLOAD (INSERT) into public/
CREATE POLICY "Authenticated users can upload to token-media/public"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'token-media'
  AND (storage.foldername(name))[1] = 'public'
);

-- 3. Allow authenticated users to UPDATE files in public/
CREATE POLICY "Authenticated users can update files in token-media/public"
ON storage.objects
FOR UPDATE
TO authenticated
USING (
  bucket_id = 'token-media'
  AND (storage.foldername(name))[1] = 'public'
)
WITH CHECK (
  bucket_id = 'token-media'
  AND (storage.foldername(name))[1] = 'public'
);

-- 4. Allow authenticated users to DELETE files in public/
CREATE POLICY "Authenticated users can delete from token-media/public"
ON storage.objects
FOR DELETE
TO authenticated
USING (
  bucket_id = 'token-media'
  AND (storage.foldername(name))[1] = 'public'
);