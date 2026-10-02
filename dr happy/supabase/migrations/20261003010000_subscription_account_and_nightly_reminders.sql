ALTER TABLE public.professionals
  ADD COLUMN IF NOT EXISTS subscription_plan text
    CHECK (subscription_plan IN ('monthly', 'semiannual', 'annual'));

CREATE TABLE public.subscription_payments (
  payment_id text PRIMARY KEY,
  professional_id text NOT NULL REFERENCES public.professionals(id) ON DELETE CASCADE,
  plan text NOT NULL CHECK (plan IN ('monthly', 'semiannual', 'annual')),
  amount numeric NOT NULL CHECK (amount > 0),
  approved_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.subscription_payments ENABLE ROW LEVEL SECURITY;

CREATE FUNCTION public.apply_subscription_payment(
  p_professional_id text, p_payment_id text, p_plan text,
  p_amount numeric, p_approved_at timestamptz
) RETURNS jsonb LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  v_professional public.professionals%ROWTYPE;
  v_payment public.subscription_payments%ROWTYPE;
  v_expiry timestamptz;
  v_days integer;
BEGIN
  IF p_plan NOT IN ('monthly', 'semiannual', 'annual') OR p_plan IS NULL
    OR p_amount IS NULL OR p_amount <= 0 OR p_approved_at IS NULL
    OR p_payment_id IS NULL OR btrim(p_payment_id) = '' THEN
    RAISE EXCEPTION 'Datos de pago inválidos';
  END IF;
  SELECT * INTO STRICT v_professional FROM public.professionals
    WHERE id = p_professional_id FOR UPDATE;
  SELECT * INTO v_payment FROM public.subscription_payments WHERE payment_id = p_payment_id;
  IF FOUND THEN
    IF v_payment.professional_id <> p_professional_id OR v_payment.plan <> p_plan THEN
      RAISE EXCEPTION 'El pago ya está asociado a otra suscripción';
    END IF;
    RETURN jsonb_build_object('applied', false, 'expiresAt', v_payment.expires_at);
  END IF;
  v_days := CASE p_plan WHEN 'annual' THEN 365 WHEN 'semiannual' THEN 180 ELSE 30 END;
  v_expiry := greatest(COALESCE(v_professional.subscription_expires_at, p_approved_at), p_approved_at)
    + make_interval(days => v_days);
  INSERT INTO public.subscription_payments(payment_id, professional_id, plan, amount, approved_at, expires_at)
    VALUES (p_payment_id, p_professional_id, p_plan, p_amount, p_approved_at, v_expiry);
  UPDATE public.professionals SET subscription_status = 'active',
    subscription_expires_at = v_expiry, subscription_plan = p_plan
    WHERE id = p_professional_id;
  RETURN jsonb_build_object('applied', true, 'expiresAt', v_expiry);
END;
$$;

CREATE FUNCTION public.subscription_account(p_professional_id text)
RETURNS jsonb LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  v_professional public.professionals%ROWTYPE;
  v_since timestamptz;
  v_reset timestamptz;
  v_usage jsonb;
  v_payments jsonb;
BEGIN
  SELECT * INTO STRICT v_professional FROM public.professionals WHERE id = p_professional_id;
  IF v_professional.subscription_status = 'active' OR v_professional.subscription_plan IS NOT NULL OR v_professional.is_admin THEN
    v_since := date_trunc('month', now() AT TIME ZONE 'America/Argentina/Buenos_Aires')
      AT TIME ZONE 'America/Argentina/Buenos_Aires';
    v_reset := (date_trunc('month', now() AT TIME ZONE 'America/Argentina/Buenos_Aires') + interval '1 month')
      AT TIME ZONE 'America/Argentina/Buenos_Aires';
  ELSE
    v_since := v_professional.trial_started_at;
  END IF;
  SELECT jsonb_build_object('used', count(*),
    'inputTokens', COALESCE(sum(input_tokens), 0),
    'outputTokens', COALESCE(sum(output_tokens), 0),
    'totalTokens', COALESCE(sum(total_tokens), 0),
    'limit', CASE WHEN v_professional.is_admin THEN 5000
      WHEN v_professional.subscription_status = 'active' OR v_professional.subscription_plan IS NOT NULL THEN 100 ELSE 3 END,
    'resetsAt', v_reset) INTO v_usage
    FROM public.ai_usage_events WHERE professional_id = p_professional_id
      AND (v_since IS NULL OR created_at >= v_since);
  SELECT COALESCE(jsonb_agg(to_jsonb(payment) ORDER BY payment.approved_at DESC), '[]'::jsonb)
    INTO v_payments FROM (
      SELECT payment_id, plan, amount, approved_at, expires_at
      FROM public.subscription_payments WHERE professional_id = p_professional_id
      ORDER BY approved_at DESC LIMIT 20
    ) payment;
  RETURN jsonb_build_object('plan', v_professional.subscription_plan,
    'status', v_professional.subscription_status,
    'expiresAt', v_professional.subscription_expires_at,
    'usage', v_usage, 'payments', v_payments);
END;
$$;

CREATE FUNCTION public.claim_sofia_consultation(p_professional_id text, p_model text)
RETURNS jsonb LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  v_professional public.professionals%ROWTYPE;
  v_account jsonb;
  v_id uuid;
BEGIN
  SELECT * INTO STRICT v_professional FROM public.professionals WHERE id = p_professional_id FOR UPDATE;
  IF NOT v_professional.active THEN RAISE EXCEPTION 'Profesional inactivo'; END IF;
  IF NOT COALESCE(v_professional.is_admin, false) AND (
    v_professional.subscription_status IN ('cancelled', 'expired')
    OR (v_professional.subscription_expires_at IS NOT NULL
      AND v_professional.subscription_expires_at <= now())
    OR (v_professional.subscription_status <> 'active' AND v_professional.trial_started_at IS NOT NULL
      AND v_professional.trial_started_at + interval '7 days' <= now())
  ) THEN RETURN jsonb_build_object('allowed', false, 'reason', 'expired'); END IF;
  v_account := public.subscription_account(p_professional_id);
  IF (v_account->'usage'->>'used')::integer >= (v_account->'usage'->>'limit')::integer THEN
    RETURN jsonb_build_object('allowed', false, 'reason', 'quota', 'usage', v_account->'usage');
  END IF;
  INSERT INTO public.ai_usage_events(professional_id, model, request_type)
    VALUES (p_professional_id, p_model, 'chat') RETURNING id INTO v_id;
  RETURN jsonb_build_object('allowed', true, 'eventId', v_id);
END;
$$;

CREATE TABLE public.appointment_reminder_deliveries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  professional_id text NOT NULL REFERENCES public.professionals(id) ON DELETE CASCADE,
  appointment_id text NOT NULL,
  slot_date date NOT NULL,
  slot_time text NOT NULL,
  status text NOT NULL CHECK (status IN ('sending', 'sent', 'failed', 'unknown')),
  sent_at timestamptz,
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (professional_id, appointment_id, slot_date, slot_time)
);
ALTER TABLE public.appointment_reminder_deliveries ENABLE ROW LEVEL SECURITY;

CREATE FUNCTION public.nightly_reminder_candidates(p_date date)
RETURNS TABLE(professional_id text, appointment_id text)
LANGUAGE sql SET search_path = public AS $$
  SELECT w.user_id, a->>'id' FROM public.user_workspaces w
    CROSS JOIN LATERAL jsonb_array_elements(w.appointments_json) a
    WHERE a->>'scheduledDate' = p_date::text
      AND COALESCE(a->>'status', '') NOT IN ('cancelled', 'attended', 'pending', 'pending_payment')
      AND COALESCE(btrim(a->>'patientEmail'), '') <> ''
      AND COALESCE(a->>'id', '') <> '';
$$;

CREATE FUNCTION public.claim_nightly_reminder(p_professional_id text, p_appointment_id text, p_date date)
RETURNS jsonb LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  v_workspace public.user_workspaces%ROWTYPE;
  v_appointment jsonb;
  v_id uuid;
  v_cutoff timestamptz;
BEGIN
  SELECT * INTO STRICT v_workspace FROM public.user_workspaces WHERE user_id = p_professional_id FOR UPDATE;
  SELECT a INTO v_appointment FROM jsonb_array_elements(v_workspace.appointments_json) a
    WHERE a->>'id' = p_appointment_id LIMIT 1;
  v_cutoff := ((p_date - 1) + time '22:00') AT TIME ZONE 'America/Argentina/Buenos_Aires';
  IF v_appointment IS NULL OR v_appointment->>'scheduledDate' <> p_date::text
    OR COALESCE(v_appointment->>'status', '') IN ('cancelled', 'attended', 'pending', 'pending_payment')
    OR COALESCE(btrim(v_appointment->>'patientEmail'), '') = ''
    OR COALESCE(v_appointment->>'scheduledTime', '') = ''
    OR (NULLIF(v_appointment->>'createdAt', '')::timestamptz > v_cutoff)
    THEN RETURN NULL; END IF;
  INSERT INTO public.appointment_reminder_deliveries
    (professional_id, appointment_id, slot_date, slot_time, status)
    VALUES (p_professional_id, p_appointment_id, p_date, v_appointment->>'scheduledTime', 'sending')
    ON CONFLICT (professional_id, appointment_id, slot_date, slot_time) DO NOTHING
    RETURNING id INTO v_id;
  IF v_id IS NULL THEN RETURN NULL; END IF;
  RETURN jsonb_build_object('deliveryId', v_id, 'appointment', v_appointment,
    'professionalName', COALESCE(v_workspace.profile_json->>'fullName', 'Tu profesional'));
END;
$$;

REVOKE ALL ON TABLE public.subscription_payments, public.appointment_reminder_deliveries FROM anon, authenticated;
REVOKE ALL ON FUNCTION public.apply_subscription_payment(text,text,text,numeric,timestamptz),
  public.subscription_account(text), public.claim_sofia_consultation(text,text),
  public.nightly_reminder_candidates(date), public.claim_nightly_reminder(text,text,date)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_subscription_payment(text,text,text,numeric,timestamptz),
  public.subscription_account(text), public.claim_sofia_consultation(text,text),
  public.nightly_reminder_candidates(date), public.claim_nightly_reminder(text,text,date)
  TO service_role;

SELECT cron.unschedule(jobid) FROM cron.job
  WHERE jobname IN ('send-appointment-reminders-every-5-minutes', 'send-appointment-reminders-nightly');
SELECT cron.schedule('send-appointment-reminders-nightly', '0 1 * * *', $job$
  SELECT net.http_post(
    url := 'https://stzsobirxdivbgqxwkhc.supabase.co/functions/v1/send-appointment-reminders',
    headers := jsonb_build_object('Content-Type', 'application/json',
      'x-cron-secret', (SELECT decrypted_secret FROM vault.decrypted_secrets
        WHERE name = 'appointment-reminders-cron-secret')),
    body := '{}'::jsonb, timeout_milliseconds := 60000
  );
$job$);
