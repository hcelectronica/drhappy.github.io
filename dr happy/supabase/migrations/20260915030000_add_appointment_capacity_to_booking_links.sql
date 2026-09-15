ALTER TABLE public.public_booking_links
  ADD COLUMN IF NOT EXISTS appointment_days JSONB NOT NULL DEFAULT '[1,2,4]'::jsonb,
  ADD COLUMN IF NOT EXISTS daily_patient_limit INTEGER NOT NULL DEFAULT 10
    CHECK (daily_patient_limit > 0 AND daily_patient_limit <= 100);
