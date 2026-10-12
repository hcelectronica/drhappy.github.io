CREATE TABLE IF NOT EXISTS public.professional_passkeys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  professional_id TEXT NOT NULL REFERENCES public.professionals(id) ON DELETE CASCADE,
  credential_id TEXT NOT NULL UNIQUE,
  public_key TEXT NOT NULL,
  sign_count BIGINT NOT NULL DEFAULT 0 CHECK (sign_count >= 0),
  transports TEXT[] NOT NULL DEFAULT '{}',
  device_type TEXT NOT NULL CHECK (device_type IN ('singleDevice', 'multiDevice')),
  backed_up BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_used_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_professional_passkeys_professional
  ON public.professional_passkeys (professional_id, created_at);

ALTER TABLE public.professional_passkeys ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.professional_passkeys FROM PUBLIC, anon, authenticated;

CREATE TABLE IF NOT EXISTS public.professional_passkey_challenges (
  challenge TEXT PRIMARY KEY,
  professional_id TEXT REFERENCES public.professionals(id) ON DELETE CASCADE,
  purpose TEXT NOT NULL CHECK (purpose IN ('registration', 'authentication')),
  expected_origin TEXT NOT NULL,
  rp_id TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_professional_passkey_challenges_expiry
  ON public.professional_passkey_challenges (expires_at);

ALTER TABLE public.professional_passkey_challenges ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.professional_passkey_challenges FROM PUBLIC, anon, authenticated;
