-- Security pass 3 (2026-11-21).
-- 1. Global daily cap on free-plan AI runs: a sign-up flood cannot drain the AI budget.
-- 2. Per-user rate limits for expensive server work (document parsing).
-- 3. Projects that still hold stored files cannot be deleted by users (no orphaned objects).
-- 4. Users may only flip notifications.read, not rewrite notification text.
-- 5. projects.progress must be 0..100.

-- ---------------------------------------------------------------------------
-- Settings that operators can change from the SQL editor, e.g.
--   UPDATE public.app_settings SET value = '500' WHERE key = 'free_ai_runs_per_day';
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.app_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.app_settings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.app_settings FROM anon, authenticated;
GRANT ALL ON public.app_settings TO service_role;
INSERT INTO public.app_settings (key, value) VALUES
  ('free_ai_runs_per_day', '200'),
  ('parse_document_per_hour', '30')
ON CONFLICT (key) DO NOTHING;

CREATE OR REPLACE FUNCTION public.app_setting_int(_key TEXT, _default INT)
RETURNS INT
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE((SELECT CASE WHEN value ~ '^[0-9]{1,9}$' THEN value::int END
                   FROM public.app_settings WHERE key = _key), _default);
$$;
REVOKE ALL ON FUNCTION public.app_setting_int(TEXT, INT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.app_setting_int(TEXT, INT) TO service_role;

-- ---------------------------------------------------------------------------
-- 1. Global daily free-plan AI cap (circuit breaker), enforced inside consume_ai_credit.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.ai_usage_daily_free (
  usage_day DATE PRIMARY KEY,
  used_count INT NOT NULL DEFAULT 0 CHECK (used_count >= 0)
);
ALTER TABLE public.ai_usage_daily_free ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ai_usage_daily_free FROM anon, authenticated;
GRANT ALL ON public.ai_usage_daily_free TO service_role;

CREATE OR REPLACE FUNCTION public.consume_ai_credit()
RETURNS TABLE(used_count INT, monthly_limit INT, remaining INT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user UUID := auth.uid();
  v_plan TEXT;
  v_limit INT;
  v_month DATE := date_trunc('month', now())::date;
  v_used INT;
  v_daily INT;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'Authentication required' USING ERRCODE = '28000'; END IF;
  v_plan := public.subscription_plan_for(v_user);
  v_limit := CASE v_plan WHEN 'premium' THEN 500 WHEN 'pro' THEN 100 ELSE 3 END;

  IF v_plan = 'free' THEN
    INSERT INTO public.ai_usage_daily_free AS d (usage_day, used_count)
    VALUES (current_date, 1)
    ON CONFLICT (usage_day) DO UPDATE
      SET used_count = d.used_count + 1
      WHERE d.used_count < public.app_setting_int('free_ai_runs_per_day', 200)
    RETURNING d.used_count INTO v_daily;
    IF v_daily IS NULL THEN
      RAISE EXCEPTION 'Free AI capacity reached for today' USING ERRCODE = 'P0001';
    END IF;
  END IF;

  INSERT INTO public.ai_usage AS current_usage (user_id, usage_month, used_count)
  VALUES (v_user, v_month, 1)
  ON CONFLICT (user_id, usage_month) DO UPDATE
    SET used_count = current_usage.used_count + 1
    WHERE current_usage.used_count < v_limit
  RETURNING current_usage.used_count INTO v_used;
  -- Raising rolls back the daily increment above as well.
  IF v_used IS NULL THEN RAISE EXCEPTION 'Monthly AI limit reached' USING ERRCODE = 'P0001'; END IF;
  RETURN QUERY SELECT v_used, v_limit, GREATEST(v_limit - v_used, 0);
END;
$$;
REVOKE ALL ON FUNCTION public.consume_ai_credit() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.consume_ai_credit() TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. Per-user fixed-window rate limits for expensive server functions.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.rate_limits (
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  bucket TEXT NOT NULL,
  window_start TIMESTAMPTZ NOT NULL,
  hits INT NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, bucket, window_start)
);
ALTER TABLE public.rate_limits ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.rate_limits FROM anon, authenticated;
GRANT ALL ON public.rate_limits TO service_role;

CREATE OR REPLACE FUNCTION public.consume_rate_limit(_bucket TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user UUID := auth.uid();
  v_max INT;
  v_window TIMESTAMPTZ := date_trunc('hour', now());
  v_hits INT;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'Authentication required' USING ERRCODE = '28000'; END IF;
  v_max := CASE _bucket
    WHEN 'parse_document' THEN public.app_setting_int('parse_document_per_hour', 30)
    ELSE NULL
  END;
  IF v_max IS NULL THEN RAISE EXCEPTION 'Unknown rate limit bucket' USING ERRCODE = '22023'; END IF;

  DELETE FROM public.rate_limits
    WHERE user_id = v_user AND bucket = _bucket AND window_start < v_window - interval '1 day';
  INSERT INTO public.rate_limits AS r (user_id, bucket, window_start, hits)
  VALUES (v_user, _bucket, v_window, 1)
  ON CONFLICT (user_id, bucket, window_start) DO UPDATE
    SET hits = r.hits + 1
    WHERE r.hits < v_max
  RETURNING r.hits INTO v_hits;
  IF v_hits IS NULL THEN RAISE EXCEPTION 'Rate limit exceeded' USING ERRCODE = 'P0001'; END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.consume_rate_limit(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.consume_rate_limit(TEXT) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3. A user cannot delete a project that still has stored files: SQL cannot remove
--    the underlying Storage objects, so they would be orphaned. The app deletes
--    files through the Storage API first. Service-role / account deletion is unaffected.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.prevent_project_delete_with_files()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NOT NULL AND EXISTS (
    SELECT 1 FROM storage.objects o
    WHERE o.bucket_id = 'project-files'
      AND o.name LIKE OLD.owner_id::text || '/' || OLD.id::text || '/%'
  ) THEN
    RAISE EXCEPTION 'Delete the project files before deleting the project' USING ERRCODE = 'P0001';
  END IF;
  RETURN OLD;
END;
$$;
DROP TRIGGER IF EXISTS prevent_project_delete_with_files ON public.projects;
CREATE TRIGGER prevent_project_delete_with_files
  BEFORE DELETE ON public.projects
  FOR EACH ROW EXECUTE FUNCTION public.prevent_project_delete_with_files();
REVOKE ALL ON FUNCTION public.prevent_project_delete_with_files() FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. Notifications: users may only mark them read.
-- ---------------------------------------------------------------------------
REVOKE UPDATE ON public.notifications FROM authenticated;
GRANT UPDATE (read) ON public.notifications TO authenticated;

-- ---------------------------------------------------------------------------
-- 5. Progress is a percentage.
-- ---------------------------------------------------------------------------
ALTER TABLE public.projects
  ADD CONSTRAINT projects_progress_range CHECK (progress BETWEEN 0 AND 100) NOT VALID;
ALTER TABLE public.stages
  ADD CONSTRAINT stages_progress_range CHECK (progress BETWEEN 0 AND 100) NOT VALID;
