-- Minimal stand-in for the parts of Supabase that the migrations depend on, so they
-- can be applied to a plain PostgreSQL database in CI. NOT for production use.
-- auth.uid() reads the GUC request.jwt.claim.sub, like Supabase's PostgREST does.
-- At upload time the RLS probe sees metadata = {mimetype, contentLength, contentEncoding}
-- (see supabase/storage src/storage/uploader.ts), which the tests reproduce.
DO $$ BEGIN
  CREATE ROLE anon NOLOGIN;
  CREATE ROLE authenticated NOLOGIN;
  CREATE ROLE service_role NOLOGIN BYPASSRLS;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE SCHEMA IF NOT EXISTS auth;
CREATE SCHEMA IF NOT EXISTS storage;
GRANT USAGE ON SCHEMA public, auth, storage TO anon, authenticated, service_role;

CREATE TABLE auth.users (id uuid PRIMARY KEY, raw_user_meta_data jsonb DEFAULT '{}');
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
  $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS
  $$ SELECT jsonb_build_object('email', 'test@example.com') $$;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA auth TO PUBLIC;

CREATE TABLE storage.buckets (
  id text PRIMARY KEY, name text, public bool, file_size_limit bigint, allowed_mime_types text[]
);
CREATE TABLE storage.objects (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY, bucket_id text, name text, owner uuid, metadata jsonb
);
ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
GRANT ALL ON storage.objects TO authenticated;
CREATE FUNCTION storage.foldername(name text) RETURNS text[] LANGUAGE sql IMMUTABLE AS
  $$ SELECT (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'), 1) - 1] $$;
GRANT EXECUTE ON FUNCTION storage.foldername(text) TO PUBLIC;
