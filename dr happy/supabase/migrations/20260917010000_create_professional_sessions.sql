CREATE TABLE IF NOT EXISTS public.professional_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  professional_id TEXT NOT NULL REFERENCES public.professionals(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_professional_sessions_active
  ON public.professional_sessions (professional_id, expires_at)
  WHERE revoked_at IS NULL;

ALTER TABLE public.professional_sessions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.professional_sessions FROM anon, authenticated;
