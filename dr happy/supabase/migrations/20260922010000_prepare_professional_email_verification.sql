-- Stand-by patch: email verification for professional registration.
-- Do not apply this migration until the verification UI is enabled.

ALTER TABLE public.professionals
  ADD COLUMN IF NOT EXISTS email_verified_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS public.professional_email_verification_challenges (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  professional_id UUID NOT NULL REFERENCES public.professionals(id) ON DELETE CASCADE,
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

ALTER TABLE public.professional_email_verification_challenges ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "No direct access to email verification challenges"
  ON public.professional_email_verification_challenges;
