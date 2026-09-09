-- Monto a cobrar opcional en los enlaces de "Turnos libres".
-- El profesional informa cuánto sale la consulta (o la seña) y su propio link
-- de cobro. Dr Happy solo muestra el dato: el pago se hace directamente entre
-- paciente y profesional, la plataforma no procesa ni intermedia la transacción.

ALTER TABLE public.public_booking_links
  ADD COLUMN IF NOT EXISTS amount_to_charge NUMERIC(12, 2)
    CHECK (amount_to_charge IS NULL OR amount_to_charge > 0);

ALTER TABLE public.public_booking_links
  ADD COLUMN IF NOT EXISTS amount_concept TEXT
    CHECK (amount_concept IS NULL OR amount_concept IN ('sena', 'consulta'));

ALTER TABLE public.public_booking_links
  ADD COLUMN IF NOT EXISTS payment_link TEXT;
