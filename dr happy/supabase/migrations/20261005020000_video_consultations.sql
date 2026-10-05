BEGIN;

CREATE TABLE public.video_consultations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  professional_id text NOT NULL REFERENCES public.professionals(id) ON DELETE CASCADE,
  patient_id text NOT NULL,
  appointment_id text,
  duration_minutes integer NOT NULL CHECK (duration_minutes BETWEEN 1 AND 120),
  lifecycle_hash text UNIQUE NOT NULL CHECK (lifecycle_hash ~ '^[a-f0-9]{64}$'),
  status text NOT NULL DEFAULT 'waiting' CHECK (status IN ('waiting', 'active', 'completed', 'expired', 'interrupted', 'rejected')),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  started_at timestamptz,
  ended_at timestamptz,
  CHECK (ended_at IS NULL OR ended_at >= created_at)
);
ALTER TABLE public.video_consultations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.video_consultations FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.video_consultations TO service_role;
CREATE INDEX video_consultations_patient ON public.video_consultations(professional_id, patient_id, created_at DESC);

CREATE FUNCTION public.advance_video_consultation(p_lifecycle_hash text, p_event text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_record public.video_consultations;
BEGIN
  IF p_event NOT IN ('start', 'completed', 'expired', 'interrupted', 'rejected') THEN
    RAISE EXCEPTION 'Invalid consultation event';
  END IF;
  SELECT * INTO v_record FROM public.video_consultations
    WHERE lifecycle_hash = p_lifecycle_hash FOR UPDATE;
  IF NOT FOUND THEN RETURN false; END IF;
  IF p_event = 'start' THEN
    IF v_record.ended_at IS NOT NULL THEN RETURN false; END IF;
    UPDATE public.video_consultations SET started_at = COALESCE(started_at, clock_timestamp()), status = 'active'
      WHERE id = v_record.id;
  ELSIF v_record.ended_at IS NULL THEN
    UPDATE public.video_consultations SET ended_at = clock_timestamp(), status = p_event
      WHERE id = v_record.id;
  END IF;
  RETURN true;
END;
$$;
REVOKE ALL ON FUNCTION public.advance_video_consultation(text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.advance_video_consultation(text, text) TO service_role;

CREATE FUNCTION public.reconcile_video_consultations(p_professional_id text)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $$
  UPDATE public.video_consultations SET status = 'expired',
    ended_at = COALESCE(started_at + duration_minutes * interval '1 minute', created_at + interval '30 minutes')
  WHERE professional_id = p_professional_id AND ended_at IS NULL
    AND COALESCE(started_at + duration_minutes * interval '1 minute', created_at + interval '30 minutes') <= clock_timestamp();
$$;
REVOKE ALL ON FUNCTION public.reconcile_video_consultations(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reconcile_video_consultations(text) TO service_role;

COMMIT;
