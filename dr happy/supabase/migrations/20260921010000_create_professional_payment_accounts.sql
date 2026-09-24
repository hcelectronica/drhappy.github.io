CREATE TABLE IF NOT EXISTS public.professional_payment_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  professional_id TEXT NOT NULL REFERENCES public.professionals(id) ON DELETE CASCADE,
  provider TEXT NOT NULL CHECK (provider = 'mercadopago'),
  provider_user_id TEXT NOT NULL,
  access_token_encrypted TEXT NOT NULL,
  refresh_token_encrypted TEXT NOT NULL,
  token_expires_at TIMESTAMPTZ NOT NULL,
  public_email TEXT,
  status TEXT NOT NULL DEFAULT 'connected' CHECK (status IN ('connected', 'revoked', 'error')),
  connected_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (professional_id, provider),
  UNIQUE (provider, provider_user_id)
);

CREATE TABLE IF NOT EXISTS public.professional_payment_oauth_states (
  state_hash TEXT PRIMARY KEY,
  professional_id TEXT NOT NULL REFERENCES public.professionals(id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.professional_payment_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.professional_payment_oauth_states ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.professional_payment_accounts FROM anon, authenticated;
REVOKE ALL ON public.professional_payment_oauth_states FROM anon, authenticated;
