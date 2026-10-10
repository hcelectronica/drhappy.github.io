BEGIN;

CREATE FUNCTION public.has_medical_tool_access(p_professional_id text, p_modules text[] DEFAULT ARRAY['attention']::text[])
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT COALESCE((
    SELECT p.active IS DISTINCT FROM false
      AND lower(COALESCE(p.specialty, '')) NOT LIKE '%odont%'
      AND (
        p.is_admin IS TRUE OR (
          translate(lower(p.specialty), 'áéíóú', 'aeiou') LIKE '%medic%'
          AND CASE WHEN p.enabled_modules_json IS NULL THEN true
            WHEN jsonb_typeof(p.enabled_modules_json) = 'array'
              THEN p.enabled_modules_json ?& p_modules
            ELSE false END
          AND (
            (p.subscription_status = 'active'
              AND (p.subscription_expires_at IS NULL OR p.subscription_expires_at > clock_timestamp()))
            OR ((p.subscription_status IS NULL OR p.subscription_status = 'trial')
              AND p.trial_started_at <= clock_timestamp()
              AND p.trial_started_at + interval '7 days' > clock_timestamp())
          )
        )
      )
    FROM public.professionals p WHERE p.id = p_professional_id
  ), false)
$$;
REVOKE ALL ON FUNCTION public.has_medical_tool_access(text, text[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.has_medical_tool_access(text, text[]) TO service_role;

CREATE OR REPLACE FUNCTION public.issue_video_handoff(p_token_hash text, p_source_hash text)
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
  WHERE s.token_hash = p_source_hash AND s.revoked_at IS NULL
    AND s.expires_at > clock_timestamp()
    AND public.has_medical_tool_access(s.professional_id)
  FOR UPDATE OF s;
  IF v_id IS NULL THEN RETURN false; END IF;
  DELETE FROM public.video_handoffs WHERE expires_at <= clock_timestamp();
  DELETE FROM public.video_handoffs WHERE professional_id = v_id;
  INSERT INTO public.video_handoffs(token_hash, professional_id, source_session_hash)
    VALUES (p_token_hash, v_id, p_source_hash);
  RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION public.consume_video_handoff(p_token_hash text)
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
  WHERE s.token_hash = v_handoff.source_session_hash
    AND s.professional_id = v_handoff.professional_id
    AND s.revoked_at IS NULL AND s.expires_at > clock_timestamp()
    AND public.has_medical_tool_access(s.professional_id);
  RETURN v_id;
END;
$$;

COMMIT;
