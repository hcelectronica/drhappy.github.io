BEGIN;

CREATE INDEX IF NOT EXISTS patient_accounts_created_at_idx ON public.patient_accounts(created_at DESC);
CREATE INDEX IF NOT EXISTS patient_accounts_verified_at_idx ON public.patient_accounts(email_verified_at) WHERE email_verified_at IS NOT NULL;

CREATE TABLE public.patient_daily_activity (
  patient_id UUID NOT NULL REFERENCES public.patient_accounts(id) ON DELETE CASCADE,
  activity_date DATE NOT NULL,
  active_minutes INTEGER NOT NULL DEFAULT 0,
  last_heartbeat_at TIMESTAMPTZ,
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  features JSONB NOT NULL DEFAULT '{}',
  PRIMARY KEY (patient_id, activity_date)
);
CREATE INDEX patient_daily_activity_date_idx ON public.patient_daily_activity(activity_date);

CREATE TABLE public.patient_registration_notices (
  patient_id UUID PRIMARY KEY REFERENCES public.patient_accounts(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sending', 'sent', 'failed')),
  attempts INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  sent_at TIMESTAMPTZ
);

ALTER TABLE public.patient_daily_activity ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.patient_registration_notices ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.patient_daily_activity, public.patient_registration_notices FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.patient_daily_activity, public.patient_registration_notices TO service_role;

CREATE FUNCTION public.queue_patient_registration_notice() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF OLD.email_verified_at IS NULL AND NEW.email_verified_at IS NOT NULL THEN
    INSERT INTO patient_registration_notices(patient_id) VALUES (NEW.id) ON CONFLICT DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER patient_registration_notice AFTER UPDATE OF email_verified_at ON public.patient_accounts
FOR EACH ROW EXECUTE FUNCTION public.queue_patient_registration_notice();
REVOKE ALL ON FUNCTION public.queue_patient_registration_notice() FROM PUBLIC, anon, authenticated;

CREATE FUNCTION public.record_patient_activity(p_patient_id UUID, p_event TEXT, p_feature TEXT DEFAULT NULL)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  day DATE := (now() AT TIME ZONE 'America/Argentina/Buenos_Aires')::date;
BEGIN
  IF p_event NOT IN ('heartbeat', 'view', 'game_completed', 'invite_clicked') OR p_event IS NULL THEN
    RAISE EXCEPTION 'Invalid activity event';
  END IF;
  IF p_event = 'view' AND (p_feature IS NULL OR p_feature NOT IN ('home','folder','upload','pressure','memory','share','account')) THEN
    RAISE EXCEPTION 'Invalid activity feature';
  END IF;
  INSERT INTO patient_daily_activity(patient_id, activity_date)
  VALUES(p_patient_id, day) ON CONFLICT DO NOTHING;
  IF p_event = 'heartbeat' THEN
    -- The first heartbeat establishes presence; later visible minutes are counted,
    -- with a shared server-side clock so multiple tabs cannot multiply minutes.
    UPDATE patient_daily_activity SET
      active_minutes = active_minutes + CASE WHEN last_heartbeat_at >= now() - interval '90 seconds' THEN 1 ELSE 0 END,
      last_heartbeat_at = now(), last_seen_at = now()
    WHERE patient_id = p_patient_id AND activity_date = day
      AND (last_heartbeat_at IS NULL OR last_heartbeat_at <= now() - interval '55 seconds');
  ELSE
    UPDATE patient_daily_activity SET
      last_seen_at = now(),
      features = jsonb_set(features, ARRAY[CASE WHEN p_event = 'view' THEN p_feature ELSE p_event END],
        to_jsonb(COALESCE((features ->> CASE WHEN p_event = 'view' THEN p_feature ELSE p_event END)::int, 0) + 1))
    WHERE patient_id = p_patient_id AND activity_date = day;
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.record_patient_activity(UUID,TEXT,TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_patient_activity(UUID,TEXT,TEXT) TO service_role;

CREATE FUNCTION public.patient_admin_stats(p_page INTEGER DEFAULT 0)
RETURNS JSONB LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
WITH bounds AS (
  SELECT (now() AT TIME ZONE 'America/Argentina/Buenos_Aires')::date AS today
), accounts AS (
  SELECT count(*) AS total,
    count(*) FILTER (WHERE email_verified_at IS NOT NULL) AS verified,
    count(*) FILTER (WHERE email_verified_at IS NULL) AS pending,
    count(*) FILTER (WHERE created_at >= (SELECT today - 6 FROM bounds)::timestamp AT TIME ZONE 'America/Argentina/Buenos_Aires') AS registrations7d,
    count(*) FILTER (WHERE created_at >= (SELECT today - 29 FROM bounds)::timestamp AT TIME ZONE 'America/Argentina/Buenos_Aires') AS registrations30d
  FROM patient_accounts
), activity AS (
  SELECT
    count(DISTINCT patient_id) FILTER (WHERE activity_date = (SELECT today FROM bounds)) AS active_today,
    count(DISTINCT patient_id) FILTER (WHERE activity_date >= (SELECT today - 6 FROM bounds)) AS active7d,
    count(DISTINCT patient_id) AS active30d,
    COALESCE(sum(active_minutes),0) AS minutes30d,
    COALESCE(sum((features->>'game_completed')::int),0) AS games30d,
    COALESCE(sum((features->>'invite_clicked')::int),0) AS invites30d
  FROM patient_daily_activity WHERE activity_date >= (SELECT today - 29 FROM bounds)
), daily AS (
  SELECT day::date AS date,
    (SELECT count(*) FROM patient_accounts a WHERE (a.created_at AT TIME ZONE 'America/Argentina/Buenos_Aires')::date = day::date) AS registrations,
    (SELECT count(*) FROM patient_accounts a WHERE (a.email_verified_at AT TIME ZONE 'America/Argentina/Buenos_Aires')::date = day::date) AS verified,
    (SELECT count(*) FROM patient_daily_activity a WHERE a.activity_date = day::date) AS active
  FROM bounds, generate_series(today - 29, today, interval '1 day') day
), features AS (
  SELECT feature.key, sum(feature.value::bigint) AS count
  FROM patient_daily_activity a CROSS JOIN LATERAL jsonb_each_text(a.features) feature
  WHERE a.activity_date >= (SELECT today - 29 FROM bounds)
  GROUP BY feature.key
), recent AS (
  SELECT a.id, a.full_name, a.email, a.created_at, a.email_verified_at, a.last_login_at, a.active,
    (SELECT max(last_seen_at) FROM patient_daily_activity WHERE patient_id = a.id) AS last_seen_at
  FROM patient_accounts a ORDER BY created_at DESC, id
  LIMIT 50 OFFSET (GREATEST(0, LEAST(p_page, 100000)) * 50)
)
SELECT jsonb_build_object(
  'summary', (SELECT to_jsonb(accounts) || to_jsonb(activity) FROM accounts CROSS JOIN activity),
  'documents', (SELECT jsonb_build_object('count',count(*),'bytes',COALESCE(sum(size_bytes),0),
    'patients',count(DISTINCT patient_id)) FROM patient_documents WHERE status='ready' AND deleted_at IS NULL),
  'pressure', (SELECT jsonb_build_object('count',count(*),'patients',count(DISTINCT patient_id))
    FROM patient_bp_readings WHERE deleted_at IS NULL),
  'shares', (SELECT jsonb_build_object('doctor',count(*) FILTER (WHERE kind='doctor'),
    'link',count(*) FILTER (WHERE kind='link')) FROM patient_shares
    WHERE revoked_at IS NULL AND (expires_at IS NULL OR expires_at > now())),
  'notices', (SELECT jsonb_build_object('sent',count(*) FILTER (WHERE status='sent'),
    'pending',count(*) FILTER (WHERE status <> 'sent')) FROM patient_registration_notices),
  'daily', (SELECT COALESCE(jsonb_agg(to_jsonb(daily) ORDER BY date DESC),'[]') FROM daily),
  'features', (SELECT COALESCE(jsonb_object_agg(key,count),'{}') FROM features),
  'recent', (SELECT COALESCE(jsonb_agg(to_jsonb(recent) ORDER BY created_at DESC,id),'[]') FROM recent),
  'trackingSince', (SELECT min(activity_date) FROM patient_daily_activity),
  'generatedAt', now()
);
$$;
REVOKE ALL ON FUNCTION public.patient_admin_stats(INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.patient_admin_stats(INTEGER) TO service_role;
COMMIT;
