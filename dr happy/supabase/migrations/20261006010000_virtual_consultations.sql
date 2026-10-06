-- Consulta virtual asistida (piloto): el paciente envía su consulta paga por un link público,
-- Sofía prepara un borrador y el profesional revisa y visa la devolución antes de enviarla.
BEGIN;

CREATE TABLE IF NOT EXISTS public.virtual_consult_settings (
  professional_id TEXT PRIMARY KEY REFERENCES public.professionals(id) ON DELETE CASCADE,
  slug TEXT NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9-]{6,80}$'),
  enabled BOOLEAN NOT NULL DEFAULT FALSE,
  price NUMERIC(12, 2) NOT NULL DEFAULT 5000 CHECK (price >= 100 AND price <= 1000000),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.virtual_consultations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  professional_id TEXT NOT NULL REFERENCES public.professionals(id) ON DELETE CASCADE,
  tracking_token TEXT NOT NULL UNIQUE CHECK (tracking_token ~ '^[a-f0-9]{64}$'),
  nombre TEXT NOT NULL CHECK (char_length(nombre) BETWEEN 1 AND 80),
  apellido TEXT NOT NULL CHECK (char_length(apellido) BETWEEN 1 AND 80),
  dni TEXT NOT NULL CHECK (dni ~ '^[0-9]{6,9}$'),
  birth_date DATE,
  phone TEXT CHECK (phone IS NULL OR char_length(phone) <= 30),
  email TEXT NOT NULL CHECK (char_length(email) <= 160),
  obra_social TEXT CHECK (obra_social IS NULL OR char_length(obra_social) <= 80),
  question TEXT NOT NULL CHECK (char_length(question) BETWEEN 10 AND 4000),
  attachments JSONB NOT NULL DEFAULT '[]'::jsonb,
  status TEXT NOT NULL DEFAULT 'pending_payment'
    CHECK (status IN ('pending_payment', 'pending_review', 'answered', 'declined', 'cancelled')),
  amount NUMERIC(12, 2) NOT NULL,
  payment_status TEXT NOT NULL DEFAULT 'pending',
  payment_id TEXT,
  payment_preference_id TEXT,
  payment_init_point TEXT,
  paid_at TIMESTAMPTZ,
  draft JSONB,
  response_text TEXT CHECK (response_text IS NULL OR char_length(response_text) <= 8000),
  decline_reason TEXT CHECK (decline_reason IS NULL OR char_length(decline_reason) <= 1000),
  pdf_path TEXT,
  answered_at TIMESTAMPTZ,
  recorded_in_chart_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_virtual_consultations_professional
  ON public.virtual_consultations (professional_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_virtual_consultations_dni
  ON public.virtual_consultations (professional_id, dni, created_at DESC);

ALTER TABLE public.virtual_consult_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.virtual_consultations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.virtual_consult_settings FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.virtual_consultations FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.virtual_consult_settings TO service_role;
GRANT ALL ON public.virtual_consultations TO service_role;

-- Adjuntos del paciente y PDF de devolución: bucket privado, solo accesible con URLs firmadas
-- generadas por la Edge Function.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('virtual-consults', 'virtual-consults', FALSE, 6291456,
  ARRAY['image/jpeg', 'image/png', 'image/webp', 'application/pdf'])
ON CONFLICT (id) DO NOTHING;

COMMIT;
