CREATE OR REPLACE FUNCTION public.recover_professional_email_verification_challenge(
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

  IF NOT FOUND THEN RETURN 'invalid'; END IF;
  IF v_request.resend_available_at > v_now THEN
    RETURN 'cooldown:' || GREATEST(1, CEIL(EXTRACT(EPOCH FROM (v_request.resend_available_at - v_now)))::INTEGER)::TEXT;
  END IF;

  IF v_request.resend_window_started_at <= v_now - INTERVAL '24 hours' THEN
    v_request.resend_window_started_at := v_now;
    v_request.resend_count := 0;
  END IF;
  IF v_request.resend_count >= 5 THEN RETURN 'limit'; END IF;

  PERFORM 1
  FROM public.professionals
  WHERE id = p_professional_id
    AND email_verification_required = TRUE
    AND email_verified_at IS NULL
  FOR UPDATE;
  IF NOT FOUND THEN RETURN 'verified'; END IF;

  UPDATE public.professional_email_verification_challenges
  SET consumed_at = v_now
  WHERE professional_id = p_professional_id AND consumed_at IS NULL;

  INSERT INTO public.professional_email_verification_challenges
    (id, professional_id, email, code_hash, expires_at)
  SELECT p_challenge_id, p_professional_id, email, p_code_hash, p_expires_at
  FROM public.professionals
  WHERE id = p_professional_id
    AND email_verification_required = TRUE
    AND email_verified_at IS NULL;

  IF NOT FOUND THEN RETURN 'verified'; END IF;

  UPDATE public.professional_email_verification_requests
  SET resume_token_hash = p_resume_token_hash,
      resend_window_started_at = v_request.resend_window_started_at,
      resend_count = v_request.resend_count + 1,
      resend_available_at = v_now + INTERVAL '60 seconds'
  WHERE professional_id = p_professional_id;

  RETURN 'ready';
END;
$$;

REVOKE ALL ON FUNCTION public.recover_professional_email_verification_challenge(TEXT, TEXT, UUID, TEXT, TIMESTAMPTZ) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.recover_professional_email_verification_challenge(TEXT, TEXT, UUID, TEXT, TIMESTAMPTZ) TO service_role;