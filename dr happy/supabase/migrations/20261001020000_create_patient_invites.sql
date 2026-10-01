CREATE TABLE IF NOT EXISTS public.patient_invite_links (
  professional_id TEXT PRIMARY KEY,
  token TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.patient_invite_submissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  professional_id TEXT NOT NULL,
  nombre TEXT NOT NULL CHECK (char_length(nombre) BETWEEN 1 AND 80),
  apellido TEXT NOT NULL CHECK (char_length(apellido) BETWEEN 1 AND 80),
  dni TEXT NOT NULL CHECK (dni ~ '^[0-9]{6,9}$'),
  birth_date DATE,
  obra_social TEXT CHECK (obra_social IS NULL OR char_length(obra_social) <= 80),
  numero_afiliado TEXT CHECK (numero_afiliado IS NULL OR char_length(numero_afiliado) <= 40),
  email TEXT CHECK (email IS NULL OR char_length(email) <= 160),
  phone TEXT CHECK (phone IS NULL OR char_length(phone) <= 30),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  imported_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_patient_invite_submissions_pending
  ON public.patient_invite_submissions (professional_id, imported_at, created_at);

ALTER TABLE public.patient_invite_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.patient_invite_submissions ENABLE ROW LEVEL SECURITY;

-- Sin políticas: solo la Edge Function patient-invite (service role) accede a estos datos.
REVOKE ALL ON public.patient_invite_links FROM anon, authenticated;
REVOKE ALL ON public.patient_invite_submissions FROM anon, authenticated;
