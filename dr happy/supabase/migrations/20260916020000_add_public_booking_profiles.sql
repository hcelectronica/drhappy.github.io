CREATE TABLE IF NOT EXISTS public.public_booking_profiles (
  professional_id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  enabled BOOLEAN NOT NULL DEFAULT FALSE,
  professional_name TEXT NOT NULL,
  location TEXT,
  reason TEXT,
  horizon_days INTEGER NOT NULL DEFAULT 60 CHECK (horizon_days >= 7 AND horizon_days <= 180),
  availability_blocks JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_public_booking_profiles_slug
  ON public.public_booking_profiles (slug);

CREATE TABLE IF NOT EXISTS public.public_booking_reservations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  professional_id TEXT NOT NULL,
  slug TEXT NOT NULL,
  slot_date DATE NOT NULL,
  slot_time TEXT NOT NULL,
  block_id TEXT NOT NULL,
  modality TEXT NOT NULL CHECK (modality IN ('coverage', 'private')),
  patient_name TEXT NOT NULL,
  patient_dni TEXT NOT NULL,
  patient_email TEXT,
  patient_phone TEXT,
  appointment_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'confirmed' CHECK (status IN ('confirmed', 'pending_payment', 'cancelled')),
  amount_to_charge NUMERIC(12, 2) CHECK (amount_to_charge IS NULL OR amount_to_charge > 0),
  amount_concept TEXT CHECK (amount_concept IS NULL OR amount_concept IN ('sena', 'consulta')),
  payment_link TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_public_booking_reservations_unique_active_slot
  ON public.public_booking_reservations (professional_id, slot_date, slot_time)
  WHERE status <> 'cancelled';

CREATE INDEX IF NOT EXISTS idx_public_booking_reservations_professional_date
  ON public.public_booking_reservations (professional_id, slot_date);

ALTER TABLE public.public_booking_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.public_booking_reservations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "No direct access to public_booking_profiles" ON public.public_booking_profiles;
DROP POLICY IF EXISTS "No direct access to public_booking_reservations" ON public.public_booking_reservations;
-- Sin políticas para anon/authenticated: sólo las Edge Functions con service role
-- pueden leer o escribir estas tablas.