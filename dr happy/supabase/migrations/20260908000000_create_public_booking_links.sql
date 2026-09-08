-- Función NUEVA e independiente de la Turnera existente: "Turnos libres" que el
-- profesional comparte por WhatsApp para que un paciente (aún no registrado)
-- elija uno de los horarios habilitados y complete sus datos. Al confirmar,
-- el turno se agrega automáticamente a la Turnera global del profesional
-- (misma tabla user_workspaces.appointments_json que ya usa la Turnera),
-- sin modificar ningún comportamiento existente de la Turnera.

CREATE TABLE IF NOT EXISTS public.public_booking_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  token TEXT NOT NULL UNIQUE,
  professional_id TEXT NOT NULL,
  professional_name TEXT,
  slot_date DATE NOT NULL,
  start_time TEXT NOT NULL,
  end_time TEXT NOT NULL,
  slot_count INTEGER NOT NULL CHECK (slot_count > 0 AND slot_count <= 50),
  location TEXT,
  reason TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'expired', 'cancelled')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_public_booking_links_professional
  ON public.public_booking_links (professional_id);

CREATE TABLE IF NOT EXISTS public.public_booking_slots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  link_id UUID NOT NULL REFERENCES public.public_booking_links(id) ON DELETE CASCADE,
  slot_time TEXT NOT NULL,
  is_booked BOOLEAN NOT NULL DEFAULT FALSE,
  patient_name TEXT,
  patient_dni TEXT,
  patient_email TEXT,
  patient_phone TEXT,
  appointment_id TEXT,
  booked_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_public_booking_slots_link
  ON public.public_booking_slots (link_id);

-- RLS: estas tablas sólo deben ser accedidas por las Edge Functions
-- (create-booking-link / public-booking) usando la Service Role Key.
-- Se bloquea todo acceso directo desde el cliente anónimo/autenticado.
ALTER TABLE public.public_booking_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.public_booking_slots ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "No direct access to public_booking_links" ON public.public_booking_links;
DROP POLICY IF EXISTS "No direct access to public_booking_slots" ON public.public_booking_slots;
-- Sin políticas para anon/authenticated: por defecto con RLS habilitado y
-- ninguna política creada, ningún rol público puede leer ni escribir.
