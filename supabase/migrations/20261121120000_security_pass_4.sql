-- Security pass 4 (2026-11-21): resource-abuse caps.
-- The active-project limit counts only active projects, so a user could create any
-- number of archived projects (each with its own file quota), and could insert
-- unlimited child rows (stages, tasks, subtasks, ...) through the REST API.
-- 1. Total projects per user (archived included), by plan.
-- 2. Row caps per parent for user-writable child tables.
-- Caps are well above what the app itself writes: one AI roadmap creates 13 stages,
-- <= 104 tasks, <= 8 subtasks / 8 tools / 7 prompts per task, <= 15 checklist items per stage.
-- service_role (auth.uid() IS NULL) is not limited.

-- ---------------------------------------------------------------------------
-- 1. Total project cap.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.enforce_total_project_cap()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_limit INT; v_count INT;
BEGIN
  IF auth.uid() IS NULL THEN RETURN NEW; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(NEW.owner_id::text, 4));
  v_limit := CASE public.subscription_plan_for(NEW.owner_id)
    WHEN 'premium' THEN 200 WHEN 'pro' THEN 50 ELSE 10 END;
  SELECT count(*) INTO v_count FROM public.projects WHERE owner_id = NEW.owner_id;
  IF v_count >= v_limit THEN
    RAISE EXCEPTION 'Total project limit reached for your subscription plan' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS enforce_total_project_cap ON public.projects;
CREATE TRIGGER enforce_total_project_cap
  BEFORE INSERT ON public.projects
  FOR EACH ROW EXECUTE FUNCTION public.enforce_total_project_cap();
REVOKE ALL ON FUNCTION public.enforce_total_project_cap() FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. Generic per-parent row cap: TG_ARGV[0] = parent column, TG_ARGV[1] = max rows.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.enforce_child_row_cap()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_col TEXT := TG_ARGV[0];
  v_max INT := TG_ARGV[1]::int;
  v_parent UUID;
  v_count INT;
BEGIN
  IF auth.uid() IS NULL THEN RETURN NEW; END IF;
  v_parent := (to_jsonb(NEW) ->> v_col)::uuid;
  IF v_parent IS NULL THEN RETURN NEW; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(TG_TABLE_NAME || ':' || v_parent::text, 5));
  EXECUTE format('SELECT count(*) FROM %I.%I WHERE %I = $1', TG_TABLE_SCHEMA, TG_TABLE_NAME, v_col)
    INTO v_count USING v_parent;
  IF v_count >= v_max THEN
    RAISE EXCEPTION 'Row limit reached for %', TG_TABLE_NAME USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.enforce_child_row_cap() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS cap_stages ON public.stages;
CREATE TRIGGER cap_stages BEFORE INSERT ON public.stages
  FOR EACH ROW EXECUTE FUNCTION public.enforce_child_row_cap('project_id', '50');
DROP TRIGGER IF EXISTS cap_tasks ON public.tasks;
CREATE TRIGGER cap_tasks BEFORE INSERT ON public.tasks
  FOR EACH ROW EXECUTE FUNCTION public.enforce_child_row_cap('project_id', '500');
DROP TRIGGER IF EXISTS cap_subtasks ON public.subtasks;
CREATE TRIGGER cap_subtasks BEFORE INSERT ON public.subtasks
  FOR EACH ROW EXECUTE FUNCTION public.enforce_child_row_cap('task_id', '50');
DROP TRIGGER IF EXISTS cap_task_tools ON public.task_tools;
CREATE TRIGGER cap_task_tools BEFORE INSERT ON public.task_tools
  FOR EACH ROW EXECUTE FUNCTION public.enforce_child_row_cap('task_id', '20');
DROP TRIGGER IF EXISTS cap_task_prompts ON public.task_prompts;
CREATE TRIGGER cap_task_prompts BEFORE INSERT ON public.task_prompts
  FOR EACH ROW EXECUTE FUNCTION public.enforce_child_row_cap('task_id', '20');
DROP TRIGGER IF EXISTS cap_checklists ON public.checklists;
CREATE TRIGGER cap_checklists BEFORE INSERT ON public.checklists
  FOR EACH ROW EXECUTE FUNCTION public.enforce_child_row_cap('stage_id', '100');
DROP TRIGGER IF EXISTS cap_activity_log ON public.activity_log;
CREATE TRIGGER cap_activity_log BEFORE INSERT ON public.activity_log
  FOR EACH ROW EXECUTE FUNCTION public.enforce_child_row_cap('project_id', '2000');

-- Indexes so the cap counts stay cheap.
CREATE INDEX IF NOT EXISTS task_tools_task_idx ON public.task_tools(task_id);
CREATE INDEX IF NOT EXISTS task_prompts_task_idx ON public.task_prompts(task_id);
CREATE INDEX IF NOT EXISTS checklists_stage_idx ON public.checklists(stage_id);
CREATE INDEX IF NOT EXISTS activity_log_project_idx ON public.activity_log(project_id);
