-- Security regression suite. Run after all migrations (see scripts/test-db.sh).
-- Each case runs as the `authenticated` role with a given auth.uid() and must either
-- succeed (allow) or fail (deny). Any mismatch fails the run with a non-zero exit code.
\set ON_ERROR_STOP on
\set QUIET on

CREATE TABLE pg_temp.results (n serial, label text, expected text, actual text, detail text);

CREATE FUNCTION pg_temp.check(_label text, _expect text, _uid uuid, _sql text, _err text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE v_actual text; v_detail text;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', _uid::text, true);
  BEGIN
    EXECUTE 'SET LOCAL ROLE authenticated';
    EXECUTE _sql;
    EXECUTE 'RESET ROLE';
    v_actual := 'allow';
  EXCEPTION WHEN others THEN
    EXECUTE 'RESET ROLE';
    v_actual := 'deny';
    v_detail := SQLERRM;
  END;
  -- A denial for the wrong reason (e.g. a typo in the test SQL) counts as a failure.
  IF v_actual = 'deny' AND _expect = 'deny' AND _err IS NOT NULL AND v_detail NOT ILIKE '%' || _err || '%' THEN
    v_actual := 'deny(other)';
  END IF;
  INSERT INTO pg_temp.results(label, expected, actual, detail) VALUES (_label, _expect, v_actual, v_detail);
END $$;

\set u1 '''11111111-1111-4111-8111-111111111111'''
\set u2 '''22222222-2222-4222-8222-222222222222'''
\set p1 '''aaaaaaaa-0000-4000-8000-000000000001'''
\set p2 '''aaaaaaaa-0000-4000-8000-000000000002'''
\set q1 '''bbbbbbbb-0000-4000-8000-000000000001'''

\o /dev/null
BEGIN;
INSERT INTO auth.users(id) VALUES (:u1), (:u2);

-- ---------------------------------------------------------------- projects / plan limits
SELECT pg_temp.check('new users get a free subscription', 'allow', :u1,
  $q$DO $d$ BEGIN IF (SELECT count(*) FROM user_subscriptions WHERE plan = 'free') <> 1 THEN RAISE EXCEPTION 'missing'; END IF; END $d$$q$);
SELECT pg_temp.check('create first project', 'allow', :u1,
  format($q$INSERT INTO projects(id, owner_id, name) VALUES (%L, %L, 'p1')$q$, :p1, :u1));
SELECT pg_temp.check('second active project on free plan', 'deny', :u1,
  format($q$INSERT INTO projects(owner_id, name) VALUES (%L, 'p2')$q$, :u1), 'limit reached');
SELECT pg_temp.check('create project for another user', 'deny', :u1,
  format($q$INSERT INTO projects(owner_id, name) VALUES (%L, 'x')$q$, :u2), 'owner must match');
SELECT pg_temp.check('archive project', 'allow', :u1,
  format($q$UPDATE projects SET status = 'archived' WHERE id = %L$q$, :p1));
SELECT pg_temp.check('create new project while the first is archived', 'allow', :u1,
  format($q$INSERT INTO projects(id, owner_id, name) VALUES (%L, %L, 'p2')$q$, :p2, :u1));
SELECT pg_temp.check('un-archive to exceed the plan limit', 'deny', :u1,
  format($q$UPDATE projects SET status = 'planning' WHERE id = %L$q$, :p1), 'limit reached');
SELECT pg_temp.check('edit an active project', 'allow', :u1,
  format($q$UPDATE projects SET progress = 10, status = 'in_progress' WHERE id = %L$q$, :p2));
SELECT pg_temp.check('transfer project to another user', 'deny', :u1,
  format($q$UPDATE projects SET owner_id = %L WHERE id = %L$q$, :u2, :p2));

-- ---------------------------------------------------------------- text limits
SELECT pg_temp.check('idea_text of 1,000,000 chars', 'deny', :u1,
  format($q$UPDATE projects SET idea_text = repeat('x', 1000000) WHERE id = %L$q$, :p2), 'projects_idea_len');
SELECT pg_temp.check('idea_text of 5,000 chars', 'allow', :u1,
  format($q$UPDATE projects SET idea_text = repeat('x', 5000) WHERE id = %L$q$, :p2));
SELECT pg_temp.check('project name of 201 chars', 'deny', :u1,
  format($q$UPDATE projects SET name = repeat('x', 201) WHERE id = %L$q$, :p2), 'projects_name_len');

-- ---------------------------------------------------------------- cross-user isolation
SELECT pg_temp.check('setup: second user project', 'allow', :u2,
  format($q$INSERT INTO projects(id, owner_id, name) VALUES (%L, %L, 'u2')$q$, :q1, :u2));
INSERT INTO stages(id, project_id, key, name) VALUES ('cccccccc-0000-4000-8000-000000000001', :q1, 'k', 's');
SELECT pg_temp.check('read another user''s projects', 'deny', :u1,
  format($q$DO $d$ BEGIN IF EXISTS (SELECT 1 FROM projects WHERE owner_id = %L) THEN RAISE EXCEPTION 'LEAK'; END IF; RAISE EXCEPTION 'none visible'; END $d$$q$, :u2), 'none visible');
SELECT pg_temp.check('update another user''s project', 'deny', :u1,
  format($q$DO $d$ BEGIN UPDATE projects SET name = 'pwned' WHERE id = %L; IF FOUND THEN RAISE EXCEPTION 'LEAK'; END IF; RAISE EXCEPTION 'no rows'; END $d$$q$, :q1), 'no rows');
SELECT pg_temp.check('link a task to another user''s stage', 'deny', :u1,
  format($q$INSERT INTO tasks(project_id, stage_id, title) VALUES (%L, 'cccccccc-0000-4000-8000-000000000001', 't')$q$, :p2), 'Stage does not belong');
SELECT pg_temp.check('create stage and task in own project', 'allow', :u1,
  format($q$INSERT INTO stages(id, project_id, key, name) VALUES ('cccccccc-0000-4000-8000-000000000002', %1$L, 'k', 's');
            INSERT INTO tasks(id, project_id, stage_id, title) VALUES ('dddddddd-0000-4000-8000-000000000001', %1$L, 'cccccccc-0000-4000-8000-000000000002', 't')$q$, :p2));

-- ---------------------------------------------------------------- task tools
SELECT pg_temp.check('https tool url', 'allow', :u1,
  $q$INSERT INTO task_tools(task_id, tool_name, url) VALUES ('dddddddd-0000-4000-8000-000000000001', 'x', 'https://figma.com')$q$);
SELECT pg_temp.check('javascript: tool url', 'deny', :u1,
  $q$INSERT INTO task_tools(task_id, tool_name, url) VALUES ('dddddddd-0000-4000-8000-000000000001', 'x', 'javascript:alert(1)')$q$, 'task_tools_url_scheme');

-- ---------------------------------------------------------------- project_files rows
SELECT pg_temp.check('file row pointing at another user''s object', 'deny', :u1,
  format($q$INSERT INTO project_files(project_id, name, storage_path) VALUES (%L, 'x', %L || '/' || %L || '/a.pdf')$q$, :p2, :u2, :q1), 'Invalid storage path');
SELECT pg_temp.check('file row in own path', 'allow', :u1,
  format($q$INSERT INTO project_files(project_id, name, storage_path) VALUES (%1$L, 'x', %2$L || '/' || %1$L || '/a.pdf')$q$, :p2, :u1));
SELECT pg_temp.check('duplicate file row for the same object', 'deny', :u1,
  format($q$INSERT INTO project_files(project_id, name, storage_path) VALUES (%1$L, 'x', %2$L || '/' || %1$L || '/a.pdf')$q$, :p2, :u1), 'duplicate key');
SELECT pg_temp.check('11 file rows on a free project', 'deny', :u1,
  format($q$INSERT INTO project_files(project_id, name, storage_path)
            SELECT %1$L, 'x', %2$L || '/' || %1$L || '/f' || g FROM generate_series(1, 10) g$q$, :p2, :u1), 'File limit reached');

-- ---------------------------------------------------------------- notifications
SELECT pg_temp.check('forge a "subscription approved" notification', 'deny', :u1,
  format($q$INSERT INTO notifications(user_id, type, title) VALUES (%L, 'subscription_approved', 'fake')$q$, :u1), 'permission denied');
SELECT pg_temp.check('mark own notifications read', 'allow', :u1,
  $q$UPDATE notifications SET read = true$q$);

-- ---------------------------------------------------------------- storage: project-files
SELECT pg_temp.check('upload 1 KB to own project folder', 'allow', :u1,
  format($q$INSERT INTO storage.objects(bucket_id, name, metadata)
            VALUES ('project-files', %L || '/' || %L || '/ok.pdf', '{"mimetype":"application/pdf","contentLength":1000}')$q$, :u1, :p2));
SELECT pg_temp.check('upload 3 MB on free plan (2 MB limit)', 'deny', :u1,
  format($q$INSERT INTO storage.objects(bucket_id, name, metadata)
            VALUES ('project-files', %L || '/' || %L || '/big.pdf', '{"contentLength":3000000}')$q$, :u1, :p2), 'row-level security');
SELECT pg_temp.check('upload without declared size', 'deny', :u1,
  format($q$INSERT INTO storage.objects(bucket_id, name, metadata) VALUES ('project-files', %L || '/' || %L || '/n.pdf', '{}')$q$, :u1, :p2), 'row-level security');
SELECT pg_temp.check('upload under a non-existent project id', 'deny', :u1,
  format($q$INSERT INTO storage.objects(bucket_id, name, metadata)
            VALUES ('project-files', %L || '/99999999-0000-4000-8000-000000000000/x.pdf', '{"contentLength":1000}')$q$, :u1), 'row-level security');
SELECT pg_temp.check('upload under another user''s project id', 'deny', :u1,
  format($q$INSERT INTO storage.objects(bucket_id, name, metadata)
            VALUES ('project-files', %L || '/' || %L || '/x.pdf', '{"contentLength":1000}')$q$, :u1, :q1), 'row-level security');
SELECT pg_temp.check('upload into another user''s folder', 'deny', :u1,
  format($q$INSERT INTO storage.objects(bucket_id, name, metadata)
            VALUES ('project-files', %L || '/' || %L || '/x.pdf', '{"contentLength":1000}')$q$, :u2, :q1), 'row-level security');
SELECT pg_temp.check('11th object in a free project folder', 'deny', :u1,
  format($q$DO $d$ BEGIN FOR i IN 1..10 LOOP
              INSERT INTO storage.objects(bucket_id, name, metadata)
              VALUES ('project-files', %L || '/' || %L || '/n' || i || '.pdf', '{"contentLength":1000}');
            END LOOP; END $d$$q$, :u1, :p2), 'row-level security');
SELECT pg_temp.check('read another user''s object', 'deny', :u2,
  $q$DO $d$ BEGIN IF EXISTS (SELECT 1 FROM storage.objects WHERE bucket_id = 'project-files') THEN RAISE EXCEPTION 'LEAK'; END IF; RAISE EXCEPTION 'none visible'; END $d$$q$, 'none visible');

-- ---------------------------------------------------------------- payments / privilege escalation
UPDATE payment_methods SET active = true, recipient_name = 'r', account_reference = 'a' WHERE sort_order = 1;
SELECT pg_temp.check('create a payment request', 'allow', :u1,
  $q$SELECT create_manual_payment_request('pro', 'monthly', (SELECT id FROM payment_methods WHERE sort_order = 1))$q$);
SELECT pg_temp.check('upload receipts 1-3 (separate uploads)', 'allow', :u1,
  format($q$DO $d$ BEGIN FOR g IN 1..3 LOOP
              INSERT INTO storage.objects(bucket_id, name)
              SELECT 'subscription-receipts', %1$L || '/' || id || '/r' || g || '.png' FROM payment_requests WHERE user_id = %1$L;
            END LOOP; END $d$$q$, :u1));
SELECT pg_temp.check('upload a 4th receipt', 'deny', :u1,
  format($q$INSERT INTO storage.objects(bucket_id, name)
            SELECT 'subscription-receipts', %1$L || '/' || id || '/r4.png' FROM payment_requests WHERE user_id = %1$L$q$, :u1), 'row-level security');
SELECT pg_temp.check('approve own payment request', 'deny', :u1,
  $q$SELECT review_manual_payment_request((SELECT id FROM payment_requests LIMIT 1), true)$q$, 'Administrator access required');
SELECT pg_temp.check('edit own subscription', 'deny', :u1,
  $q$UPDATE user_subscriptions SET plan = 'premium', billing_period = 'annual', starts_at = now(), ends_at = now() + interval '9 years'$q$, 'permission denied');
SELECT pg_temp.check('grant self admin', 'deny', :u1,
  format($q$INSERT INTO user_roles(user_id, role) VALUES (%L, 'admin')$q$, :u1), 'permission denied');
SELECT pg_temp.check('call bootstrap_subscription_admin', 'deny', :u1,
  format($q$SELECT bootstrap_subscription_admin(%L)$q$, :u1), 'permission denied');
SELECT pg_temp.check('reset own AI usage counter', 'deny', :u1,
  $q$UPDATE ai_usage SET used_count = 0$q$, 'permission denied');
SELECT pg_temp.check('edit payment method details', 'deny', :u1,
  $q$DO $d$ BEGIN UPDATE payment_methods SET account_reference = 'attacker'; IF FOUND THEN RAISE EXCEPTION 'LEAK'; END IF; RAISE EXCEPTION 'no rows'; END $d$$q$, 'no rows');
SELECT pg_temp.check('consume AI credits up to the free limit (3)', 'allow', :u1,
  $q$SELECT consume_ai_credit(); SELECT consume_ai_credit(); SELECT consume_ai_credit()$q$);
SELECT pg_temp.check('4th AI credit on free plan', 'deny', :u1,
  $q$SELECT consume_ai_credit()$q$, 'Monthly AI limit reached');

-- ---------------------------------------------------------------- report
\o
\set QUIET off
\pset footer off
SELECT n AS "#", CASE WHEN expected = actual THEN 'PASS' ELSE 'FAIL' END AS result,
       label, expected, actual, left(coalesce(detail, ''), 70) AS detail
FROM pg_temp.results ORDER BY n;

DO $$
DECLARE v_fail int; v_total int;
BEGIN
  SELECT count(*) FILTER (WHERE expected <> actual), count(*) INTO v_fail, v_total FROM pg_temp.results;
  IF v_fail > 0 THEN
    RAISE EXCEPTION '% of % security checks FAILED', v_fail, v_total;
  END IF;
  RAISE NOTICE 'All % security checks passed', v_total;
END $$;
ROLLBACK;
