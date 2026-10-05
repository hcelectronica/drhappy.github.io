BEGIN;

CREATE TABLE public.video_handoffs (
  token_hash text PRIMARY KEY CHECK (token_hash ~ '^[a-f0-9]{64}$'),
  professional_id text NOT NULL REFERENCES public.professionals(id) ON DELETE CASCADE,
  source_session_hash text NOT NULL,
  expires_at timestamptz NOT NULL DEFAULT (clock_timestamp() + interval '60 seconds')
);
ALTER TABLE public.video_handoffs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.video_handoffs FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.video_handoffs TO service_role;
CREATE INDEX video_handoffs_expiry ON public.video_handoffs(expires_at);

CREATE FUNCTION public.issue_video_handoff(p_token_hash text, p_source_hash text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_id text;
BEGIN
  SELECT s.professional_id INTO v_id
  FROM public.professional_sessions s
  JOIN public.professionals p ON p.id = s.professional_id
  WHERE s.token_hash = p_source_hash AND s.revoked_at IS NULL
    AND s.expires_at > clock_timestamp() AND p.active IS DISTINCT FROM false AND p.is_admin IS TRUE
  FOR UPDATE OF s;
  IF v_id IS NULL THEN RETURN false; END IF;
  DELETE FROM public.video_handoffs WHERE expires_at <= clock_timestamp();
  DELETE FROM public.video_handoffs WHERE professional_id = v_id;
  INSERT INTO public.video_handoffs(token_hash, professional_id, source_session_hash)
    VALUES (p_token_hash, v_id, p_source_hash);
  RETURN true;
END;
$$;

CREATE FUNCTION public.consume_video_handoff(p_token_hash text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_handoff public.video_handoffs;
  v_id text;
BEGIN
  DELETE FROM public.video_handoffs WHERE token_hash = p_token_hash RETURNING * INTO v_handoff;
  IF NOT FOUND OR v_handoff.expires_at <= clock_timestamp() THEN RETURN NULL; END IF;
  SELECT s.professional_id INTO v_id
  FROM public.professional_sessions s
  JOIN public.professionals p ON p.id = s.professional_id
  WHERE s.token_hash = v_handoff.source_session_hash
    AND s.professional_id = v_handoff.professional_id
    AND s.revoked_at IS NULL AND s.expires_at > clock_timestamp()
    AND p.active IS DISTINCT FROM false AND p.is_admin IS TRUE;
  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.issue_video_handoff(text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.consume_video_handoff(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_video_handoff(text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.consume_video_handoff(text) TO service_role;

COMMIT;
