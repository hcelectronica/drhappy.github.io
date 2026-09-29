-- Stand-by patch: email verification for professional registration.
-- Apply only in development after deploying the matching Edge Functions.

ALTER TABLE public.professionals
  ADD COLUMN IF NOT EXISTS email_verified_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS email_verification_required BOOLEAN NOT NULL DEFAULT FALSE;

CREATE TABLE IF NOT EXISTS public.professional_email_verification_challenges (
  id UUID PRIMARY KEY,
  professional_id TEXT NOT NULL REFERENCES public.professionals(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  code_hash TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_professional_email_verification_active
  ON public.professional_email_verification_challenges (professional_id, expires_at)
  WHERE consumed_at IS NULL;

CREATE TABLE IF NOT EXISTS public.professional_email_verification_requests (
  professional_id TEXT PRIMARY KEY REFERENCES public.professionals(id) ON DELETE CASCADE,
  resume_token_hash TEXT NOT NULL,
  resend_available_at TIMESTAMPTZ NOT NULL,
  resend_window_started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resend_count INTEGER NOT NULL DEFAULT 0 CHECK (resend_count >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.professional_email_verification_challenges ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.professional_email_verification_requests ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.professional_email_verification_challenges FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.professional_email_verification_requests FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.professional_email_verification_challenges TO service_role;
GRANT ALL ON public.professional_email_verification_requests TO service_role;

CREATE OR REPLACE FUNCTION public.create_professional_email_verification_registration(
  p_username TEXT,
  p_password_hash TEXT,
  p_full_name TEXT,
  p_specialty TEXT,
  p_license_number TEXT,
  p_dni TEXT,
  p_email TEXT,
  p_network_memberships JSONB,
  p_challenge_id UUID,
  p_code_hash TEXT,
  p_expires_at TIMESTAMPTZ,
  p_resume_token_hash TEXT,
  p_created_at TIMESTAMPTZ
)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_professional_id TEXT;
BEGIN
  INSERT INTO public.professionals (
    username, password_hash, full_name, specialty, license_number, dni, email,
    network_memberships_json, trial_started_at, subscription_status, email_verification_required
  ) VALUES (
    p_username, p_password_hash, p_full_name, p_specialty, p_license_number, p_dni, p_email,
    COALESCE(p_network_memberships, '[]'::JSONB), p_created_at, 'trial', TRUE
  )
  RETURNING id INTO v_professional_id;

  INSERT INTO public.professional_email_verification_challenges
    (id, professional_id, email, code_hash, expires_at)
  VALUES (p_challenge_id, v_professional_id, p_email, p_code_hash, p_expires_at);

  INSERT INTO public.professional_email_verification_requests
    (professional_id, resume_token_hash, resend_available_at)
  VALUES (v_professional_id, p_resume_token_hash, p_created_at + INTERVAL '60 seconds');

  RETURN v_professional_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.rotate_professional_email_verification_challenge(
  p_professional_id TEXT,
  p_resume_token_hash TEXT,
  p_challenge_id UUID,
  p_code_hash TEXT,
  p_expires_at TIMESTAMPTZ
)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_request public.professional_email_verification_requests%ROWTYPE;
  v_now TIMESTAMPTZ := CLOCK_TIMESTAMP();
BEGIN
  SELECT * INTO v_request
  FROM public.professional_email_verification_requests
  WHERE professional_id = p_professional_id
  FOR UPDATE;

  IF NOT FOUND OR v_request.resume_token_hash <> p_resume_token_hash THEN
    RETURN 'invalid';
  END IF;
  IF v_request.resend_available_at > v_now THEN
    RETURN 'cooldown:' || GREATEST(1, CEIL(EXTRACT(EPOCH FROM (v_request.resend_available_at - v_now)))::INTEGER)::TEXT;
  END IF;

  IF v_request.resend_window_started_at <= v_now - INTERVAL '24 hours' THEN
    v_request.resend_window_started_at := v_now;
    v_request.resend_count := 0;
  END IF;
  IF v_request.resend_count >= 5 THEN
    RETURN 'limit';
  END IF;

  UPDATE public.professional_email_verification_requests
  SET resend_window_started_at = v_request.resend_window_started_at,
      resend_count = v_request.resend_count + 1,
      resend_available_at = v_now + INTERVAL '60 seconds'
  WHERE professional_id = p_professional_id;

  UPDATE public.professional_email_verification_challenges
  SET consumed_at = v_now
  WHERE professional_id = p_professional_id AND consumed_at IS NULL;

  INSERT INTO public.professional_email_verification_challenges
    (id, professional_id, email, code_hash, expires_at)
  SELECT p_challenge_id, p_professional_id, email, p_code_hash, p_expires_at
  FROM public.professionals
  WHERE id = p_professional_id AND email_verification_required AND email_verified_at IS NULL;

  IF NOT FOUND THEN
    RETURN 'verified';
  END IF;
  RETURN 'ready';
END;
$$;

CREATE OR REPLACE FUNCTION public.verify_professional_email_challenge(
  p_professional_id TEXT,
  p_challenge_id UUID,
  p_code_hash TEXT,
  p_now TIMESTAMPTZ,
  p_max_attempts INTEGER
)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_challenge public.professional_email_verification_challenges%ROWTYPE;
BEGIN
  SELECT * INTO v_challenge
  FROM public.professional_email_verification_challenges
  WHERE id = p_challenge_id AND professional_id = p_professional_id
  FOR UPDATE;

  IF NOT FOUND OR v_challenge.consumed_at IS NOT NULL THEN RETURN 'invalid'; END IF;
  IF v_challenge.expires_at <= p_now THEN RETURN 'expired'; END IF;
  IF v_challenge.attempts >= p_max_attempts THEN RETURN 'locked'; END IF;

  IF v_challenge.code_hash <> p_code_hash THEN
    UPDATE public.professional_email_verification_challenges
    SET attempts = attempts + 1
    WHERE id = p_challenge_id;
    IF v_challenge.attempts + 1 >= p_max_attempts THEN RETURN 'locked'; END IF;
    RETURN 'invalid';
  END IF;

  UPDATE public.professionals
  SET email_verified_at = p_now
  WHERE id = p_professional_id
    AND email_verification_required = TRUE
    AND email_verified_at IS NULL;
  IF NOT FOUND THEN RETURN 'already_verified'; END IF;

  UPDATE public.professional_email_verification_challenges
  SET consumed_at = p_now
  WHERE id = p_challenge_id;
  RETURN 'verified';
END;
$$;

REVOKE ALL ON FUNCTION public.create_professional_email_verification_registration(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, JSONB, UUID, TEXT, TIMESTAMPTZ, TEXT, TIMESTAMPTZ) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.rotate_professional_email_verification_challenge(TEXT, TEXT, UUID, TEXT, TIMESTAMPTZ) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.verify_professional_email_challenge(TEXT, UUID, TEXT, TIMESTAMPTZ, INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_professional_email_verification_registration(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, JSONB, UUID, TEXT, TIMESTAMPTZ, TEXT, TIMESTAMPTZ) TO service_role;
GRANT EXECUTE ON FUNCTION public.rotate_professional_email_verification_challenge(TEXT, TEXT, UUID, TEXT, TIMESTAMPTZ) TO service_role;
GRANT EXECUTE ON FUNCTION public.verify_professional_email_challenge(TEXT, UUID, TEXT, TIMESTAMPTZ, INTEGER) TO service_role;
