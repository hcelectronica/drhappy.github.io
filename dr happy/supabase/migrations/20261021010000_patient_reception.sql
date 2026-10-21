BEGIN;
CREATE TABLE public.patient_receptions (
  professional_id text PRIMARY KEY REFERENCES public.professionals(id) ON DELETE CASCADE,
  slug text NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9]([a-z0-9-]{0,22}[a-z0-9])?$'),
  display_name text NOT NULL CHECK (length(display_name) BETWEEN 1 AND 80),
  enabled boolean NOT NULL DEFAULT false,
  documents boolean NOT NULL DEFAULT false,
  studies boolean NOT NULL DEFAULT false,
  booking boolean NOT NULL DEFAULT false,
  registration boolean NOT NULL DEFAULT false,
  video boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.patient_receptions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.patient_receptions FROM anon, authenticated;
GRANT ALL ON public.patient_receptions TO service_role;

ALTER TABLE public.public_booking_reservations
  ADD COLUMN video_notice_claimed_at timestamptz,
  ADD COLUMN consultation_mode text NOT NULL DEFAULT 'presential'
  CHECK (consultation_mode IN ('presential', 'video'));
COMMIT;
