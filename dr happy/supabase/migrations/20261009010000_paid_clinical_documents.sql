BEGIN;

CREATE TABLE IF NOT EXISTS public.paid_clinical_document_settings (
  professional_id TEXT PRIMARY KEY REFERENCES public.professionals(id) ON DELETE CASCADE,
  slug TEXT NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9-]{6,80}$'),
  certificate_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  certificate_price NUMERIC(12, 2) NOT NULL DEFAULT 0 CHECK (certificate_price >= 0 AND certificate_price <= 1000000),
  study_order_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  study_order_price NUMERIC(12, 2) NOT NULL DEFAULT 0 CHECK (study_order_price >= 0 AND study_order_price <= 1000000),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.paid_clinical_document_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  professional_id TEXT NOT NULL REFERENCES public.professionals(id) ON DELETE CASCADE,
  tracking_token TEXT NOT NULL UNIQUE CHECK (tracking_token ~ '^[a-f0-9]{64}$'),
  service_type TEXT NOT NULL CHECK (service_type IN ('certificate', 'study-order')),
  requested_purpose TEXT NOT NULL CHECK (char_length(requested_purpose) BETWEEN 1 AND 80),
  patient_first_name TEXT NOT NULL CHECK (char_length(patient_first_name) BETWEEN 1 AND 80),
  patient_last_name TEXT NOT NULL CHECK (char_length(patient_last_name) BETWEEN 1 AND 80),
  patient_dni TEXT NOT NULL CHECK (patient_dni ~ '^[0-9]{6,9}$'),
  patient_email TEXT NOT NULL CHECK (char_length(patient_email) <= 160),
  patient_phone TEXT NOT NULL CHECK (char_length(patient_phone) BETWEEN 8 AND 30),
  patient_birth_date DATE,
  reason TEXT NOT NULL CHECK (char_length(reason) BETWEEN 5 AND 2000),
  amount NUMERIC(12, 2) NOT NULL CHECK (amount >= 100 AND amount <= 1000000),
  status TEXT NOT NULL DEFAULT 'pending_payment'
    CHECK (status IN ('pending_payment', 'pending_review', 'completed', 'cancelled')),
  payment_status TEXT NOT NULL DEFAULT 'pending',
  payment_id TEXT UNIQUE,
  payment_preference_id TEXT,
  payment_init_point TEXT,
  paid_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_paid_clinical_document_requests_professional
  ON public.paid_clinical_document_requests (professional_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_paid_clinical_document_requests_dni
  ON public.paid_clinical_document_requests (professional_id, patient_dni, created_at DESC);

ALTER TABLE public.paid_clinical_document_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.paid_clinical_document_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.paid_clinical_document_settings FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.paid_clinical_document_requests FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.paid_clinical_document_settings TO service_role;
GRANT ALL ON public.paid_clinical_document_requests TO service_role;

COMMIT;
