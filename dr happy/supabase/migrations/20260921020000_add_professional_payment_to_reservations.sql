ALTER TABLE public.public_booking_reservations
  ADD COLUMN IF NOT EXISTS payment_preference_id TEXT,
  ADD COLUMN IF NOT EXISTS payment_init_point TEXT,
  ADD COLUMN IF NOT EXISTS payment_status TEXT NOT NULL DEFAULT 'pending';

CREATE INDEX IF NOT EXISTS idx_public_booking_reservations_payment_preference
  ON public.public_booking_reservations (payment_preference_id);
