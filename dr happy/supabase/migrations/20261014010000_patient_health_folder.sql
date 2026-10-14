-- Carpeta de Salud (Fase 1): cuentas de pacientes independientes de los profesionales,
-- estudios en bucket privado y registro de accesos. Solo la Edge Function (service_role) accede.
BEGIN;

CREATE TABLE IF NOT EXISTS public.patient_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  full_name TEXT NOT NULL,
  dni TEXT NOT NULL,
  birth_date DATE,
  phone TEXT,
  email_verified_at TIMESTAMPTZ,
  consent_accepted_at TIMESTAMPTZ NOT NULL,
  consent_version TEXT NOT NULL DEFAULT 'v1',
  storage_used_bytes BIGINT NOT NULL DEFAULT 0,
  storage_quota_bytes BIGINT NOT NULL DEFAULT 314572800,
  failed_login_count INTEGER NOT NULL DEFAULT 0,
  locked_until TIMESTAMPTZ,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  last_login_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS patient_accounts_email_key ON public.patient_accounts (LOWER(email));
CREATE INDEX IF NOT EXISTS patient_accounts_dni_idx ON public.patient_accounts (dni);

CREATE TABLE IF NOT EXISTS public.patient_email_codes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id UUID NOT NULL REFERENCES public.patient_accounts(id) ON DELETE CASCADE,
  purpose TEXT NOT NULL CHECK (purpose IN ('verify', 'reset')),
  code_hash TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS patient_email_codes_lookup_idx ON public.patient_email_codes (patient_id, purpose, created_at DESC);

CREATE TABLE IF NOT EXISTS public.patient_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id UUID NOT NULL REFERENCES public.patient_accounts(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS patient_sessions_patient_idx ON public.patient_sessions (patient_id);

CREATE TABLE IF NOT EXISTS public.patient_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id UUID NOT NULL REFERENCES public.patient_accounts(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'otros'
    CHECK (category IN ('laboratorio', 'imagenes', 'recetas', 'informes', 'vacunas', 'otros')),
  study_date DATE,
  notes TEXT,
  file_path TEXT NOT NULL UNIQUE,
  mime_type TEXT NOT NULL,
  size_bytes BIGINT NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'ready')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS patient_documents_patient_idx
  ON public.patient_documents (patient_id, study_date DESC NULLS LAST, created_at DESC)
  WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS public.patient_access_log (
  id BIGSERIAL PRIMARY KEY,
  patient_id UUID NOT NULL REFERENCES public.patient_accounts(id) ON DELETE CASCADE,
  document_id UUID,
  actor TEXT NOT NULL DEFAULT 'patient',
  action TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS patient_access_log_patient_idx ON public.patient_access_log (patient_id, created_at DESC);

ALTER TABLE public.patient_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.patient_email_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.patient_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.patient_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.patient_access_log ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.patient_accounts, public.patient_email_codes, public.patient_sessions,
  public.patient_documents, public.patient_access_log FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.patient_accounts, public.patient_email_codes, public.patient_sessions,
  public.patient_documents, public.patient_access_log TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.patient_access_log_id_seq TO service_role;

-- Bucket privado: los archivos solo se suben/leen con URLs firmadas emitidas por la Edge Function.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('patient-folders', 'patient-folders', FALSE, 10485760,
  ARRAY['image/jpeg', 'image/png', 'image/webp', 'application/pdf'])
ON CONFLICT (id) DO NOTHING;

COMMIT;
