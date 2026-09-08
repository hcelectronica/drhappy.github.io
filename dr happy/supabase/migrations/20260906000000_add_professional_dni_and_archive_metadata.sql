ALTER TABLE public.professionals
  ADD COLUMN IF NOT EXISTS dni TEXT;

ALTER TABLE public.deleted_user_archives
  ADD COLUMN IF NOT EXISTS deleted_dni TEXT;
