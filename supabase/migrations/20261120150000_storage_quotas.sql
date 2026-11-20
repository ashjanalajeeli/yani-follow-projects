-- Follow-up to 20261120090000_security_hardening.sql (second audit pass).
-- ---------------------------------------------------------------------------
-- 7. Storage quotas. Clients can call the Storage API directly, bypassing the
--    app, so the object store itself must enforce:
--    - project-files: <uid>/<own project id>/<file>, at most the plan's
--      per-project file quota of objects per project folder;
--    - subscription-receipts: at most 3 objects per payment request.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.can_upload_project_object(_name TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_parts TEXT[] := string_to_array(_name, '/');
  v_project UUID;
  v_limit INT;
BEGIN
  IF auth.uid() IS NULL OR array_length(v_parts, 1) <> 3 OR v_parts[1] <> auth.uid()::text
     OR v_parts[2] !~ '^[0-9a-fA-F-]{36}$' THEN
    RETURN false;
  END IF;
  v_project := v_parts[2]::uuid;
  IF NOT EXISTS (SELECT 1 FROM public.projects WHERE id = v_project AND owner_id = auth.uid()) THEN
    RETURN false;
  END IF;
  v_limit := CASE public.subscription_plan_for(auth.uid()) WHEN 'premium' THEN 200 WHEN 'pro' THEN 50 ELSE 10 END;
  RETURN (SELECT count(*) FROM storage.objects o
          WHERE o.bucket_id = 'project-files' AND o.name LIKE v_parts[1] || '/' || v_parts[2] || '/%') < v_limit;
END;
$$;
REVOKE ALL ON FUNCTION public.can_upload_project_object(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_upload_project_object(TEXT) TO authenticated, service_role;

DROP POLICY IF EXISTS "own bucket write" ON storage.objects;
CREATE POLICY "own bucket write" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'project-files' AND auth.uid()::text = (storage.foldername(name))[1]
    AND public.allow_project_file_size(metadata)
    AND public.can_upload_project_object(name));
DROP POLICY IF EXISTS "own bucket update" ON storage.objects;
CREATE POLICY "own bucket update" ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'project-files' AND auth.uid()::text = (storage.foldername(name))[1])
  WITH CHECK (bucket_id = 'project-files' AND auth.uid()::text = (storage.foldername(name))[1]
    AND public.allow_project_file_size(metadata));

CREATE OR REPLACE FUNCTION public.can_upload_receipt_object(_name TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_parts TEXT[] := string_to_array(_name, '/');
BEGIN
  IF auth.uid() IS NULL OR array_length(v_parts, 1) <> 3 OR v_parts[1] <> auth.uid()::text THEN
    RETURN false;
  END IF;
  RETURN (SELECT count(*) FROM storage.objects o
          WHERE o.bucket_id = 'subscription-receipts' AND o.name LIKE v_parts[1] || '/' || v_parts[2] || '/%') < 3;
END;
$$;
REVOKE ALL ON FUNCTION public.can_upload_receipt_object(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_upload_receipt_object(TEXT) TO authenticated, service_role;

DROP POLICY IF EXISTS "own receipt write" ON storage.objects;
CREATE POLICY "own receipt write" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'subscription-receipts' AND auth.uid()::text = (storage.foldername(name))[1]
    AND public.can_upload_receipt_object(name)
    AND EXISTS (
      SELECT 1 FROM public.payment_requests r
      WHERE r.id::text = (storage.foldername(name))[2] AND r.user_id = auth.uid() AND r.status = 'pending_receipt'
    ));
