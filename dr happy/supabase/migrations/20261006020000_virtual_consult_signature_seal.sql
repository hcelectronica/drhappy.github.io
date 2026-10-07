ALTER TABLE public.virtual_consultations
  ADD COLUMN IF NOT EXISTS signature_seal JSONB;
