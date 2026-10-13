-- Tabla de agregados diarios de actividad por profesional.
-- Diseñada para escalar a cientos o miles de profesionales con consultas ultra-rápidas.
-- No guarda ningún dato clínico privado del paciente (sólo contadores y tiempos anónimos).

CREATE TABLE IF NOT EXISTS public.professional_daily_activity (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  professional_id TEXT NOT NULL REFERENCES public.professionals(id) ON DELETE CASCADE,
  activity_date DATE NOT NULL DEFAULT CURRENT_DATE,
  active_minutes INTEGER NOT NULL DEFAULT 0 CHECK (active_minutes >= 0),
  sessions_count INTEGER NOT NULL DEFAULT 1 CHECK (sessions_count >= 0),
  consultations_count INTEGER NOT NULL DEFAULT 0 CHECK (consultations_count >= 0),
  prescriptions_count INTEGER NOT NULL DEFAULT 0 CHECK (prescriptions_count >= 0),
  certificates_count INTEGER NOT NULL DEFAULT 0 CHECK (certificates_count >= 0),
  appointments_count INTEGER NOT NULL DEFAULT 0 CHECK (appointments_count >= 0),
  patients_created_count INTEGER NOT NULL DEFAULT 0 CHECK (patients_created_count >= 0),
  last_heartbeat_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_professional_daily_activity UNIQUE (professional_id, activity_date)
);

CREATE INDEX IF NOT EXISTS idx_prof_daily_activity_date
  ON public.professional_daily_activity (activity_date DESC);

CREATE INDEX IF NOT EXISTS idx_prof_daily_activity_prof_date
  ON public.professional_daily_activity (professional_id, activity_date DESC);

ALTER TABLE public.professional_daily_activity ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.professional_daily_activity FROM PUBLIC, anon, authenticated;

-- Índice para consultas rápidas de presencia y último acceso en professionals.
CREATE INDEX IF NOT EXISTS idx_professionals_last_seen
  ON public.professionals (last_seen_at DESC NULLS LAST);

-- Función RPC para registrar latidos (heartbeats) y contadores de acción de forma atómica.
CREATE OR REPLACE FUNCTION public.record_professional_heartbeat(
  p_professional_id TEXT,
  p_minutes INTEGER DEFAULT 1,
  p_consultations INTEGER DEFAULT 0,
  p_prescriptions INTEGER DEFAULT 0,
  p_certificates INTEGER DEFAULT 0,
  p_appointments INTEGER DEFAULT 0,
  p_patients INTEGER DEFAULT 0
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.professionals
  SET last_seen_at = NOW()
  WHERE id = p_professional_id;

  INSERT INTO public.professional_daily_activity (
    professional_id,
    activity_date,
    active_minutes,
    sessions_count,
    consultations_count,
    prescriptions_count,
    certificates_count,
    appointments_count,
    patients_created_count,
    last_heartbeat_at,
    updated_at
  )
  VALUES (
    p_professional_id,
    CURRENT_DATE,
    GREATEST(0, COALESCE(p_minutes, 1)),
    1,
    GREATEST(0, COALESCE(p_consultations, 0)),
    GREATEST(0, COALESCE(p_prescriptions, 0)),
    GREATEST(0, COALESCE(p_certificates, 0)),
    GREATEST(0, COALESCE(p_appointments, 0)),
    GREATEST(0, COALESCE(p_patients, 0)),
    NOW(),
    NOW()
  )
  ON CONFLICT (professional_id, activity_date)
  DO UPDATE SET
    active_minutes = public.professional_daily_activity.active_minutes + GREATEST(0, COALESCE(EXCLUDED.active_minutes, 0)),
    consultations_count = public.professional_daily_activity.consultations_count + GREATEST(0, COALESCE(EXCLUDED.consultations_count, 0)),
    prescriptions_count = public.professional_daily_activity.prescriptions_count + GREATEST(0, COALESCE(EXCLUDED.prescriptions_count, 0)),
    certificates_count = public.professional_daily_activity.certificates_count + GREATEST(0, COALESCE(EXCLUDED.certificates_count, 0)),
    appointments_count = public.professional_daily_activity.appointments_count + GREATEST(0, COALESCE(EXCLUDED.appointments_count, 0)),
    patients_created_count = public.professional_daily_activity.patients_created_count + GREATEST(0, COALESCE(EXCLUDED.patients_created_count, 0)),
    last_heartbeat_at = NOW(),
    updated_at = NOW();
END;
$$;

REVOKE ALL ON FUNCTION public.record_professional_heartbeat FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_professional_heartbeat TO service_role;
