ALTER TABLE public.virtual_consult_settings
  ADD COLUMN IF NOT EXISTS letterhead TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS logo_data_url TEXT;
