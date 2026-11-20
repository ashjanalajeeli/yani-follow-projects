-- Security hardening (audit 2026-11-20).
-- 1. Active-project limit can no longer be bypassed by archiving and un-archiving projects.
-- 2. Length limits on user text that is sent to the AI gateway or stored.
-- 3. project-files size policy reads the metadata Storage actually sends at upload time.
-- 4. Per-project file quota, unique storage paths, and storage paths bound to owner/project.
-- 5. Child rows cannot reference stages/tasks that belong to a different project.
-- 6. Users can no longer forge notifications; tool/avatar URLs must be http(s).

-- ---------------------------------------------------------------------------
-- 1. Project limit on INSERT and on re-activation (UPDATE of status/owner).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.project_status_is_inactive(_status TEXT)
RETURNS BOOLEAN
LANGUAGE SQL
IMMUTABLE
SET search_path = public
AS $$
  SELECT lower(coalesce(_status, '')) IN ('completed', 'complete', 'archived', 'done');
$$;

CREATE OR REPLACE FUNCTION public.enforce_subscription_project_limit()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_limit INT;
DECLARE v_count INT;
BEGIN
  IF auth.uid() IS NOT NULL AND auth.uid() <> NEW.owner_id THEN
    RAISE EXCEPTION 'Project owner must match the authenticated user' USING ERRCODE = '42501';
  END IF;

  -- Only a row that becomes (or is created as) an active project consumes a slot.
  IF public.project_status_is_inactive(NEW.status) THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE'
     AND NOT public.project_status_is_inactive(OLD.status)
     AND OLD.owner_id = NEW.owner_id THEN
    RETURN NEW; -- was already active: no new slot taken
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(NEW.owner_id::text, 2));
  v_limit := public.project_plan_limit(NEW.owner_id);
  SELECT count(*) INTO v_count FROM public.projects
    WHERE owner_id = NEW.owner_id
      AND id <> NEW.id
      AND NOT public.project_status_is_inactive(status);
  IF v_count >= v_limit THEN
    RAISE EXCEPTION 'Active project limit reached for your subscription plan' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS enforce_subscription_project_limit ON public.projects;
CREATE TRIGGER enforce_subscription_project_limit
  BEFORE INSERT OR UPDATE OF status, owner_id ON public.projects
  FOR EACH ROW EXECUTE FUNCTION public.enforce_subscription_project_limit();
REVOKE ALL ON FUNCTION public.enforce_subscription_project_limit() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enforce_subscription_project_limit() TO service_role;

-- ---------------------------------------------------------------------------
-- 2. Length limits (NOT VALID: enforced for new/updated rows, existing rows untouched).
-- ---------------------------------------------------------------------------
ALTER TABLE public.projects
  ADD CONSTRAINT projects_name_len CHECK (char_length(name) BETWEEN 1 AND 200) NOT VALID,
  ADD CONSTRAINT projects_description_len CHECK (description IS NULL OR char_length(description) <= 2000) NOT VALID,
  ADD CONSTRAINT projects_idea_len CHECK (idea_text IS NULL OR char_length(idea_text) <= 20000) NOT VALID;
ALTER TABLE public.tasks
  ADD CONSTRAINT tasks_title_len CHECK (char_length(title) <= 500) NOT VALID,
  ADD CONSTRAINT tasks_description_len CHECK (description IS NULL OR char_length(description) <= 10000) NOT VALID,
  ADD CONSTRAINT tasks_expected_output_len CHECK (expected_output IS NULL OR char_length(expected_output) <= 5000) NOT VALID;
ALTER TABLE public.subtasks
  ADD CONSTRAINT subtasks_title_len CHECK (char_length(title) <= 500) NOT VALID;
ALTER TABLE public.checklists
  ADD CONSTRAINT checklists_item_len CHECK (char_length(item) <= 1000) NOT VALID;
ALTER TABLE public.stages
  ADD CONSTRAINT stages_name_len CHECK (char_length(name) <= 200) NOT VALID,
  ADD CONSTRAINT stages_description_len CHECK (description IS NULL OR char_length(description) <= 2000) NOT VALID;
ALTER TABLE public.task_prompts
  ADD CONSTRAINT task_prompts_len CHECK (char_length(prompt_text) <= 20000 AND char_length(target) <= 50) NOT VALID;
ALTER TABLE public.project_files
  ADD CONSTRAINT project_files_name_len CHECK (char_length(name) <= 255) NOT VALID,
  ADD CONSTRAINT project_files_parsed_len CHECK (parsed_text IS NULL OR char_length(parsed_text) <= 200000) NOT VALID;
ALTER TABLE public.activity_log
  ADD CONSTRAINT activity_log_len CHECK (char_length(action) <= 100 AND (meta IS NULL OR pg_column_size(meta) <= 8192)) NOT VALID;
ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_full_name_len CHECK (full_name IS NULL OR char_length(full_name) <= 200) NOT VALID,
  ADD CONSTRAINT profiles_avatar_url_scheme CHECK (avatar_url IS NULL OR avatar_url ~* '^https?://') NOT VALID;

-- 6a. Tool links are rendered as <a href>: only http(s).
ALTER TABLE public.task_tools
  ADD CONSTRAINT task_tools_url_scheme CHECK (url IS NULL OR url ~* '^https?://[^\s]+$') NOT VALID,
  ADD CONSTRAINT task_tools_len CHECK (char_length(tool_name) <= 200 AND (why IS NULL OR char_length(why) <= 2000)) NOT VALID;

-- ---------------------------------------------------------------------------
-- 3. Storage size policy. At the pre-upload RLS probe Storage passes
--    metadata = {mimetype, contentLength, contentEncoding}; "size" only exists
--    after the upload completes. The old policy read only "size" and rejected
--    every upload.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.allow_project_file_size(_object_metadata JSONB)
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE WHEN v ~ '^[0-9]{1,12}$'
    THEN v::bigint > 0 AND v::bigint <= public.subscription_file_size_limit(auth.uid())
    ELSE false
  END
  FROM (SELECT COALESCE(_object_metadata ->> 'contentLength', _object_metadata ->> 'size', '') AS v) m;
$$;
REVOKE ALL ON FUNCTION public.allow_project_file_size(JSONB) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.allow_project_file_size(JSONB) TO authenticated, service_role;

-- Lets the server function enforce the plan limit on the real stored size.
CREATE OR REPLACE FUNCTION public.my_file_size_limit()
RETURNS BIGINT
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.subscription_file_size_limit(auth.uid());
$$;
REVOKE ALL ON FUNCTION public.my_file_size_limit() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_file_size_limit() TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 4. project_files: unique path, path bound to owner/project, per-project quota.
-- ---------------------------------------------------------------------------
DELETE FROM public.project_files f
USING public.project_files g
WHERE f.storage_path = g.storage_path
  AND (coalesce(length(f.parsed_text), -1), f.created_at, f.id::text)
    < (coalesce(length(g.parsed_text), -1), g.created_at, g.id::text);
CREATE UNIQUE INDEX IF NOT EXISTS project_files_storage_path_key ON public.project_files(storage_path);

CREATE OR REPLACE FUNCTION public.enforce_project_file_rules()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_owner UUID;
  v_limit INT;
  v_count INT;
BEGIN
  SELECT owner_id INTO v_owner FROM public.projects WHERE id = NEW.project_id;
  IF v_owner IS NULL THEN
    RAISE EXCEPTION 'Project not found' USING ERRCODE = '23503';
  END IF;
  IF NEW.storage_path IS NULL
     OR NEW.storage_path NOT LIKE v_owner::text || '/' || NEW.project_id::text || '/%'
     OR NEW.storage_path LIKE '%..%' THEN
    RAISE EXCEPTION 'Invalid storage path' USING ERRCODE = '22023';
  END IF;
  IF NEW.task_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.tasks t WHERE t.id = NEW.task_id AND t.project_id = NEW.project_id
  ) THEN
    RAISE EXCEPTION 'Task does not belong to this project' USING ERRCODE = '42501';
  END IF;
  IF TG_OP = 'INSERT' THEN
    PERFORM pg_advisory_xact_lock(hashtextextended(NEW.project_id::text, 3));
    v_limit := CASE public.subscription_plan_for(v_owner) WHEN 'premium' THEN 200 WHEN 'pro' THEN 50 ELSE 10 END;
    SELECT count(*) INTO v_count FROM public.project_files WHERE project_id = NEW.project_id;
    IF v_count >= v_limit THEN
      RAISE EXCEPTION 'File limit reached for this project' USING ERRCODE = 'P0001';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS enforce_project_file_rules ON public.project_files;
CREATE TRIGGER enforce_project_file_rules
  BEFORE INSERT OR UPDATE OF project_id, task_id, storage_path ON public.project_files
  FOR EACH ROW EXECUTE FUNCTION public.enforce_project_file_rules();
REVOKE ALL ON FUNCTION public.enforce_project_file_rules() FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5. tasks.stage_id must belong to the task's own project.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.enforce_task_stage_same_project()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.stage_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.stages s WHERE s.id = NEW.stage_id AND s.project_id = NEW.project_id
  ) THEN
    RAISE EXCEPTION 'Stage does not belong to this project' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS enforce_task_stage_same_project ON public.tasks;
CREATE TRIGGER enforce_task_stage_same_project
  BEFORE INSERT OR UPDATE OF stage_id, project_id ON public.tasks
  FOR EACH ROW EXECUTE FUNCTION public.enforce_task_stage_same_project();
REVOKE ALL ON FUNCTION public.enforce_task_stage_same_project() FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 6b. Notifications are written only by trusted SECURITY DEFINER functions.
-- ---------------------------------------------------------------------------
REVOKE INSERT ON public.notifications FROM authenticated;
DROP POLICY IF EXISTS "own notifications" ON public.notifications;
CREATE POLICY "read own notifications" ON public.notifications FOR SELECT TO authenticated
  USING (auth.uid() = user_id);
CREATE POLICY "update own notifications" ON public.notifications FOR UPDATE TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "delete own notifications" ON public.notifications FOR DELETE TO authenticated
  USING (auth.uid() = user_id);
