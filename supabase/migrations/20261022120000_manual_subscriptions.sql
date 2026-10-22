-- Manual USD subscriptions: no card data or automatic payment verification is stored.

CREATE OR REPLACE FUNCTION public.is_subscription_admin()
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = auth.uid() AND role = 'admin'
  );
$$;
REVOKE ALL ON FUNCTION public.is_subscription_admin() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_subscription_admin() TO authenticated, service_role;

CREATE TABLE public.user_subscriptions (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  plan TEXT NOT NULL DEFAULT 'free' CHECK (plan IN ('free', 'pro', 'premium')),
  billing_period TEXT CHECK (billing_period IS NULL OR billing_period IN ('monthly', 'annual')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'expired', 'cancelled')),
  starts_at TIMESTAMPTZ,
  ends_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK ((plan = 'free' AND billing_period IS NULL) OR (plan <> 'free' AND billing_period IS NOT NULL AND starts_at IS NOT NULL AND ends_at IS NOT NULL))
);
ALTER TABLE public.user_subscriptions ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.user_subscriptions TO authenticated;
GRANT ALL ON public.user_subscriptions TO service_role;
CREATE POLICY "users read own subscription" ON public.user_subscriptions FOR SELECT TO authenticated
  USING (auth.uid() = user_id OR public.is_subscription_admin());

CREATE TABLE public.payment_methods (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  recipient_name TEXT NOT NULL DEFAULT '',
  account_reference TEXT NOT NULL DEFAULT '',
  currency TEXT NOT NULL DEFAULT 'USD',
  instructions TEXT NOT NULL DEFAULT '',
  active BOOLEAN NOT NULL DEFAULT false,
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.payment_methods ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.payment_methods TO authenticated;
GRANT INSERT, UPDATE, DELETE ON public.payment_methods TO authenticated;
GRANT ALL ON public.payment_methods TO service_role;
CREATE POLICY "users read active payment methods" ON public.payment_methods FOR SELECT TO authenticated
  USING (active OR public.is_subscription_admin() OR EXISTS (
    SELECT 1 FROM public.payment_requests r WHERE r.payment_method_id = payment_methods.id AND r.user_id = auth.uid()
  ));
CREATE POLICY "admins manage payment methods" ON public.payment_methods FOR ALL TO authenticated
  USING (public.is_subscription_admin()) WITH CHECK (public.is_subscription_admin());

INSERT INTO public.payment_methods (name, sort_order) VALUES
  ('بنك الجزيرة', 1),
  ('بن يعله', 2),
  ('ويسترن يونيون', 3),
  ('بنك حضرموت', 4),
  ('بنك بن دول', 5),
  ('البسيري بي كاش', 6),
  ('القطيبي', 7),
  ('الكريمي', 8)
ON CONFLICT (name) DO NOTHING;

CREATE TABLE public.payment_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  contact_email TEXT NOT NULL DEFAULT '',
  plan TEXT NOT NULL CHECK (plan IN ('pro', 'premium')),
  billing_period TEXT NOT NULL CHECK (billing_period IN ('monthly', 'annual')),
  payment_method_id UUID NOT NULL REFERENCES public.payment_methods(id),
  amount_usd_cents INT NOT NULL CHECK (amount_usd_cents > 0),
  status TEXT NOT NULL DEFAULT 'pending_receipt'
    CHECK (status IN ('pending_receipt', 'pending_review', 'approved', 'rejected', 'cancelled')),
  receipt_path TEXT,
  user_note TEXT NOT NULL DEFAULT '',
  admin_note TEXT NOT NULL DEFAULT '',
  reviewed_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK ((status IN ('approved', 'rejected')) = (reviewed_at IS NOT NULL)),
  CHECK (status NOT IN ('pending_review', 'approved', 'rejected') OR receipt_path IS NOT NULL)
);
CREATE UNIQUE INDEX payment_requests_one_open_per_user
  ON public.payment_requests(user_id) WHERE status IN ('pending_receipt', 'pending_review');
CREATE INDEX payment_requests_admin_queue_idx ON public.payment_requests(status, created_at DESC);
ALTER TABLE public.payment_requests ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.payment_requests TO authenticated;
GRANT ALL ON public.payment_requests TO service_role;
CREATE POLICY "users read own payment requests" ON public.payment_requests FOR SELECT TO authenticated
  USING (auth.uid() = user_id OR public.is_subscription_admin());

CREATE TABLE public.ai_usage (
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  usage_month DATE NOT NULL,
  used_count INT NOT NULL DEFAULT 0 CHECK (used_count >= 0),
  PRIMARY KEY (user_id, usage_month)
);
ALTER TABLE public.ai_usage ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.ai_usage TO authenticated;
GRANT ALL ON public.ai_usage TO service_role;
CREATE POLICY "users read own AI usage" ON public.ai_usage FOR SELECT TO authenticated
  USING (auth.uid() = user_id OR public.is_subscription_admin());

CREATE OR REPLACE FUNCTION public.subscription_plan_for(_user_id UUID)
RETURNS TEXT
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE
    WHEN s.status = 'active' AND (s.ends_at IS NULL OR s.ends_at > now()) THEN s.plan
    ELSE 'free'
  END
  FROM public.user_subscriptions s
  WHERE s.user_id = _user_id
  UNION ALL
  SELECT 'free'
  WHERE NOT EXISTS (SELECT 1 FROM public.user_subscriptions s WHERE s.user_id = _user_id)
  LIMIT 1;
$$;
REVOKE ALL ON FUNCTION public.subscription_plan_for(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.subscription_plan_for(UUID) TO service_role;

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
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'Authentication required' USING ERRCODE = '28000'; END IF;
  v_plan := public.subscription_plan_for(v_user);
  v_limit := CASE v_plan WHEN 'premium' THEN 500 WHEN 'pro' THEN 100 ELSE 3 END;
  INSERT INTO public.ai_usage AS current_usage (user_id, usage_month, used_count)
  VALUES (v_user, v_month, 1)
  ON CONFLICT (user_id, usage_month) DO UPDATE
    SET used_count = current_usage.used_count + 1
    WHERE current_usage.used_count < v_limit
  RETURNING current_usage.used_count INTO v_used;
  IF v_used IS NULL THEN RAISE EXCEPTION 'Monthly AI limit reached' USING ERRCODE = 'P0001'; END IF;
  RETURN QUERY SELECT v_used, v_limit, GREATEST(v_limit - v_used, 0);
END;
$$;
REVOKE ALL ON FUNCTION public.consume_ai_credit() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.consume_ai_credit() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.create_manual_payment_request(
  _plan TEXT,
  _billing_period TEXT,
  _payment_method_id UUID,
  _user_note TEXT DEFAULT ''
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user UUID := auth.uid();
  v_request UUID;
  v_amount INT;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'Authentication required' USING ERRCODE = '28000'; END IF;
  IF _plan NOT IN ('pro', 'premium') OR _billing_period NOT IN ('monthly', 'annual') THEN
    RAISE EXCEPTION 'Invalid plan or billing period' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.payment_methods WHERE id = _payment_method_id AND active
      AND btrim(recipient_name) <> '' AND btrim(account_reference) <> '') THEN
    RAISE EXCEPTION 'Payment method is unavailable' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.user_subscriptions s
    WHERE s.user_id = v_user AND s.plan <> 'free' AND s.status = 'active' AND s.ends_at > now()
  ) THEN RAISE EXCEPTION 'An active paid subscription already exists' USING ERRCODE = 'P0001'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(v_user::text, 1));
  IF (SELECT count(*) FROM public.payment_requests r WHERE r.user_id = v_user AND r.created_at > now() - interval '24 hours') >= 5 THEN
    RAISE EXCEPTION 'Payment request limit reached' USING ERRCODE = 'P0001';
  END IF;
  v_amount := CASE
    WHEN _plan = 'pro' AND _billing_period = 'monthly' THEN 699
    WHEN _plan = 'pro' AND _billing_period = 'annual' THEN 5900
    WHEN _plan = 'premium' AND _billing_period = 'monthly' THEN 1499
    WHEN _plan = 'premium' AND _billing_period = 'annual' THEN 12900
  END;
  INSERT INTO public.payment_requests (user_id, contact_email, plan, billing_period, payment_method_id, amount_usd_cents, user_note)
  VALUES (v_user, COALESCE(auth.jwt() ->> 'email', ''), _plan, _billing_period, _payment_method_id, v_amount, left(COALESCE(_user_note, ''), 500))
  RETURNING id INTO v_request;
  RETURN v_request;
END;
$$;
REVOKE ALL ON FUNCTION public.create_manual_payment_request(TEXT, TEXT, UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_manual_payment_request(TEXT, TEXT, UUID, TEXT) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.attach_payment_receipt(_request_id UUID, _receipt_path TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_user UUID := auth.uid();
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'Authentication required' USING ERRCODE = '28000'; END IF;
  IF _receipt_path IS NULL OR length(_receipt_path) > 1024 OR _receipt_path !~ ('^' || v_user::text || '/' || _request_id::text || '/[^/]+$') THEN
    RAISE EXCEPTION 'Invalid receipt path' USING ERRCODE = '22023';
  END IF;
  UPDATE public.payment_requests
  SET receipt_path = _receipt_path, status = 'pending_review'
  WHERE id = _request_id AND user_id = v_user AND status = 'pending_receipt';
  IF NOT FOUND THEN RAISE EXCEPTION 'Payment request is unavailable' USING ERRCODE = 'P0001'; END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.attach_payment_receipt(UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.attach_payment_receipt(UUID, TEXT) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.cancel_manual_payment_request(_request_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.payment_requests
  SET status = 'cancelled'
  WHERE id = _request_id AND user_id = auth.uid() AND status IN ('pending_receipt', 'pending_review');
  IF NOT FOUND THEN RAISE EXCEPTION 'Payment request is unavailable' USING ERRCODE = 'P0001'; END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.cancel_manual_payment_request(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cancel_manual_payment_request(UUID) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.review_manual_payment_request(_request_id UUID, _approve BOOLEAN, _admin_note TEXT DEFAULT '')
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_request public.payment_requests%ROWTYPE;
BEGIN
  IF NOT public.is_subscription_admin() THEN RAISE EXCEPTION 'Administrator access required' USING ERRCODE = '42501'; END IF;
  SELECT * INTO v_request FROM public.payment_requests WHERE id = _request_id FOR UPDATE;
  IF NOT FOUND OR v_request.status <> 'pending_review' OR v_request.receipt_path IS NULL THEN
    RAISE EXCEPTION 'Payment request is not ready for review' USING ERRCODE = 'P0001';
  END IF;
  UPDATE public.payment_requests
  SET status = CASE WHEN _approve THEN 'approved' ELSE 'rejected' END,
      admin_note = left(COALESCE(_admin_note, ''), 1000),
      reviewed_by = auth.uid(), reviewed_at = now()
  WHERE id = _request_id;
  IF _approve THEN
    INSERT INTO public.user_subscriptions (user_id, plan, billing_period, status, starts_at, ends_at, updated_at)
    VALUES (
      v_request.user_id, v_request.plan, v_request.billing_period, 'active', now(),
      now() + CASE WHEN v_request.billing_period = 'annual' THEN interval '1 year' ELSE interval '1 month' END,
      now()
    )
    ON CONFLICT (user_id) DO UPDATE SET
      plan = EXCLUDED.plan, billing_period = EXCLUDED.billing_period, status = 'active',
      starts_at = EXCLUDED.starts_at, ends_at = EXCLUDED.ends_at, updated_at = now();
  END IF;
  INSERT INTO public.notifications (user_id, type, title, body, link)
  VALUES (
    v_request.user_id,
    CASE WHEN _approve THEN 'subscription_approved' ELSE 'subscription_rejected' END,
    CASE WHEN _approve THEN 'تم تفعيل اشتراكك' ELSE 'تمت مراجعة طلب الاشتراك' END,
    CASE WHEN _approve THEN 'تم تفعيل خطتك المدفوعة.' ELSE COALESCE(NULLIF(left(_admin_note, 300), ''), 'يرجى مراجعة إيصال الدفع أو التواصل مع الدعم.') END,
    '/billing'
  );
END;
$$;
REVOKE ALL ON FUNCTION public.review_manual_payment_request(UUID, BOOLEAN, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.review_manual_payment_request(UUID, BOOLEAN, TEXT) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.project_plan_limit(_user_id UUID)
RETURNS INT
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE public.subscription_plan_for(_user_id) WHEN 'premium' THEN 20 WHEN 'pro' THEN 5 ELSE 1 END;
$$;
REVOKE ALL ON FUNCTION public.project_plan_limit(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.project_plan_limit(UUID) TO service_role;

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
  PERFORM pg_advisory_xact_lock(hashtextextended(NEW.owner_id::text, 2));
  v_limit := public.project_plan_limit(NEW.owner_id);
  SELECT count(*) INTO v_count FROM public.projects
    WHERE owner_id = NEW.owner_id AND lower(status) NOT IN ('completed', 'complete', 'archived', 'done');
  IF v_count >= v_limit THEN
    RAISE EXCEPTION 'Active project limit reached for your subscription plan' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS enforce_subscription_project_limit ON public.projects;
CREATE TRIGGER enforce_subscription_project_limit
  BEFORE INSERT ON public.projects FOR EACH ROW EXECUTE FUNCTION public.enforce_subscription_project_limit();
REVOKE ALL ON FUNCTION public.enforce_subscription_project_limit() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enforce_subscription_project_limit() TO service_role;

CREATE OR REPLACE FUNCTION public.subscription_file_size_limit(_user_id UUID)
RETURNS BIGINT
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE public.subscription_plan_for(_user_id)
    WHEN 'premium' THEN 26214400::bigint
    WHEN 'pro' THEN 10485760::bigint
    ELSE 2097152::bigint
  END;
$$;
REVOKE ALL ON FUNCTION public.subscription_file_size_limit(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.subscription_file_size_limit(UUID) TO service_role;

CREATE OR REPLACE FUNCTION public.allow_project_file_size(_object_metadata JSONB)
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE WHEN COALESCE(_object_metadata ->> 'size', '') ~ '^[0-9]+$'
    THEN (_object_metadata ->> 'size')::bigint <= public.subscription_file_size_limit(auth.uid())
    ELSE false
  END;
$$;
REVOKE ALL ON FUNCTION public.allow_project_file_size(JSONB) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.allow_project_file_size(JSONB) TO authenticated, service_role;

-- Ensure existing and future accounts receive an explicit Free entitlement.
INSERT INTO public.user_subscriptions (user_id, plan, status)
SELECT id, 'free', 'active' FROM auth.users
ON CONFLICT (user_id) DO NOTHING;
CREATE OR REPLACE FUNCTION public.create_free_subscription_for_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.user_subscriptions (user_id, plan, status)
  VALUES (NEW.id, 'free', 'active') ON CONFLICT (user_id) DO NOTHING;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS create_free_subscription_for_new_user ON auth.users;
CREATE TRIGGER create_free_subscription_for_new_user
  AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION public.create_free_subscription_for_new_user();
REVOKE ALL ON FUNCTION public.create_free_subscription_for_new_user() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_free_subscription_for_new_user() TO service_role;

-- Private proof bucket: image/PDF only, never public.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('subscription-receipts', 'subscription-receipts', false, 10485760,
  ARRAY['image/jpeg', 'image/png', 'image/webp', 'application/pdf'])
ON CONFLICT (id) DO UPDATE SET public = false, file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;
DROP POLICY IF EXISTS "own receipt read" ON storage.objects;
CREATE POLICY "own receipt read" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'subscription-receipts' AND (
    public.is_subscription_admin() OR EXISTS (
      SELECT 1 FROM public.payment_requests r
      WHERE r.id::text = (storage.foldername(name))[2] AND r.user_id = auth.uid()
    )
  ));
DROP POLICY IF EXISTS "own receipt write" ON storage.objects;
CREATE POLICY "own receipt write" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'subscription-receipts' AND auth.uid()::text = (storage.foldername(name))[1] AND EXISTS (
    SELECT 1 FROM public.payment_requests r
    WHERE r.id::text = (storage.foldername(name))[2] AND r.user_id = auth.uid() AND r.status = 'pending_receipt'
  ));
DROP POLICY IF EXISTS "own receipt delete" ON storage.objects;
CREATE POLICY "own receipt delete" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'subscription-receipts' AND auth.uid()::text = (storage.foldername(name))[1] AND EXISTS (
    SELECT 1 FROM public.payment_requests r
    WHERE r.id::text = (storage.foldername(name))[2] AND r.user_id = auth.uid() AND r.status IN ('pending_receipt', 'cancelled')
  ));

-- The project-files bucket is capped globally at 25 MiB; RLS applies smaller plan limits.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('project-files', 'project-files', false, 26214400,
  ARRAY['application/pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'text/plain', 'text/markdown'])
ON CONFLICT (id) DO UPDATE SET public = false, file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;
DROP POLICY IF EXISTS "own bucket read" ON storage.objects;
CREATE POLICY "own bucket read" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'project-files' AND auth.uid()::text = (storage.foldername(name))[1]);
DROP POLICY IF EXISTS "own bucket write" ON storage.objects;
CREATE POLICY "own bucket write" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'project-files' AND auth.uid()::text = (storage.foldername(name))[1]
    AND public.allow_project_file_size(metadata));
DROP POLICY IF EXISTS "own bucket update" ON storage.objects;
CREATE POLICY "own bucket update" ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'project-files' AND auth.uid()::text = (storage.foldername(name))[1])
  WITH CHECK (bucket_id = 'project-files' AND auth.uid()::text = (storage.foldername(name))[1]
    AND public.allow_project_file_size(metadata));
DROP POLICY IF EXISTS "own bucket delete" ON storage.objects;
CREATE POLICY "own bucket delete" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'project-files' AND auth.uid()::text = (storage.foldername(name))[1]);

-- Bootstrap the first administrator explicitly from the Supabase SQL editor using the user's Auth UUID.
CREATE OR REPLACE FUNCTION public.bootstrap_subscription_admin(_user_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM auth.users WHERE id = _user_id) THEN
    RAISE EXCEPTION 'Supabase Auth user not found' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.user_roles (user_id, role) VALUES (_user_id, 'admin')
  ON CONFLICT (user_id, role) DO NOTHING;
END;
$$;
REVOKE ALL ON FUNCTION public.bootstrap_subscription_admin(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.bootstrap_subscription_admin(UUID) TO service_role;

COMMENT ON FUNCTION public.bootstrap_subscription_admin(UUID) IS
  'Run manually from the Supabase SQL editor as project owner: SELECT public.bootstrap_subscription_admin(''YOUR_AUTH_USER_UUID''::uuid);';
