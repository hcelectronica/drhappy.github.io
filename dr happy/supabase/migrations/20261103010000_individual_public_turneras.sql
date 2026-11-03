ALTER TABLE public.public_booking_reservations
  ADD COLUMN IF NOT EXISTS duration_minutes INTEGER,
  ADD COLUMN IF NOT EXISTS block_label TEXT,
  ADD COLUMN IF NOT EXISTS location TEXT,
  ADD COLUMN IF NOT EXISTS reason TEXT;

-- Preserve the booked interval and conditions even if its turnera is edited later.
UPDATE public.public_booking_reservations r
SET duration_minutes = COALESCE((b.value->>'durationMinutes')::integer, 30),
    block_label = b.value->>'label',
    location = COALESCE(b.value->>'location', p.location),
    reason = COALESCE(b.value->>'reason', p.reason)
FROM public.public_booking_profiles p,
     LATERAL jsonb_array_elements(p.availability_blocks) b(value)
WHERE r.professional_id = p.professional_id AND r.block_id = b.value->>'id'
  AND r.duration_minutes IS NULL;
UPDATE public.public_booking_reservations SET duration_minutes = 30 WHERE duration_minutes IS NULL;
ALTER TABLE public.public_booking_reservations ALTER COLUMN duration_minutes SET DEFAULT 30;
ALTER TABLE public.public_booking_reservations ALTER COLUMN duration_minutes SET NOT NULL;
ALTER TABLE public.public_booking_reservations ADD CONSTRAINT booking_duration_range CHECK (duration_minutes BETWEEN 5 AND 240);

CREATE OR REPLACE FUNCTION public.reserve_public_booking(p_reservation JSONB, p_appointment JSONB DEFAULT NULL)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_professional TEXT := p_reservation->>'professional_id';
  v_date DATE := (p_reservation->>'slot_date')::date;
  v_time TIME := (p_reservation->>'slot_time')::time;
  v_block JSONB;
  v_profile public.public_booking_profiles%ROWTYPE;
  v_workspace JSONB;
  v_duration INTEGER := (p_reservation->>'duration_minutes')::integer;
  v_start INTEGER;
  v_end INTEGER;
  v_count INTEGER;
  v_quota INTEGER;
  v_amount NUMERIC;
BEGIN
  -- All public turneras of this professional serialize through the same lock.
  SELECT * INTO v_profile FROM public.public_booking_profiles
    WHERE professional_id = v_professional FOR UPDATE;
  IF NOT FOUND OR NOT v_profile.enabled THEN
    RETURN jsonb_build_object('success', false, 'message', 'Esta turnera no esta disponible.');
  END IF;
  SELECT value INTO v_block FROM jsonb_array_elements(v_profile.availability_blocks)
    WHERE value->>'id' = p_reservation->>'block_id' LIMIT 1;
  IF v_block IS NULL OR COALESCE((v_block->>'enabled')::boolean, true) = false THEN
    RETURN jsonb_build_object('success', false, 'message', 'Esta turnera esta pausada.');
  END IF;
  v_amount := CASE WHEN v_block->>'modality' = 'private' THEN (v_block->>'amountToCharge')::numeric ELSE NULL END;
  IF v_duration IS DISTINCT FROM (v_block->>'durationMinutes')::integer
    OR v_amount IS DISTINCT FROM (p_reservation->>'amount_to_charge')::numeric
    OR v_block->>'modality' IS DISTINCT FROM p_reservation->>'modality'
    OR (v_amount IS NOT NULL AND COALESCE(v_block->>'amountConcept', 'consulta') IS DISTINCT FROM COALESCE(p_reservation->>'amount_concept', 'consulta')) THEN
    RETURN jsonb_build_object('success', false, 'message', 'La configuracion cambio. Volve a abrir la turnera.');
  END IF;
  v_start := EXTRACT(HOUR FROM v_time)::integer * 60 + EXTRACT(MINUTE FROM v_time)::integer;
  v_end := v_start + v_duration;
  IF v_date < (NOW() AT TIME ZONE 'America/Argentina/Buenos_Aires')::date
    OR v_date > (NOW() AT TIME ZONE 'America/Argentina/Buenos_Aires')::date + 59
    OR NOT (v_block->'days' @> to_jsonb(ARRAY[EXTRACT(DOW FROM v_date)::integer]))
    OR v_time < (v_block->>'startTime')::time
    OR v_end > EXTRACT(HOUR FROM (v_block->>'endTime')::time)::integer * 60 + EXTRACT(MINUTE FROM (v_block->>'endTime')::time)::integer
    OR MOD(v_start - (EXTRACT(HOUR FROM (v_block->>'startTime')::time)::integer * 60 + EXTRACT(MINUTE FROM (v_block->>'startTime')::time)::integer), v_duration) <> 0
    OR (v_start - (EXTRACT(HOUR FROM (v_block->>'startTime')::time)::integer * 60 + EXTRACT(MINUTE FROM (v_block->>'startTime')::time)::integer)) / v_duration >= (v_block->>'slotCount')::integer THEN
    RETURN jsonb_build_object('success', false, 'message', 'Ese horario no esta habilitado.');
  END IF;

  INSERT INTO public.user_workspaces(user_id) VALUES(v_professional) ON CONFLICT (user_id) DO NOTHING;
  SELECT appointments_json INTO v_workspace FROM public.user_workspaces WHERE user_id = v_professional FOR UPDATE;
  v_workspace := COALESCE(v_workspace, '[]'::jsonb);

  UPDATE public.public_booking_reservations SET status = 'cancelled', payment_status = 'expired'
    WHERE professional_id = v_professional AND status = 'pending_payment' AND created_at < NOW() - INTERVAL '15 minutes';

  IF EXISTS (
    SELECT 1 FROM public.public_booking_reservations r
    WHERE r.professional_id = v_professional AND r.slot_date = v_date AND r.status <> 'cancelled'
      AND EXTRACT(HOUR FROM r.slot_time::time)::integer * 60 + EXTRACT(MINUTE FROM r.slot_time::time)::integer < v_end
      AND EXTRACT(HOUR FROM r.slot_time::time)::integer * 60 + EXTRACT(MINUTE FROM r.slot_time::time)::integer + r.duration_minutes > v_start
  ) OR EXISTS (
    SELECT 1 FROM jsonb_array_elements(v_workspace) a
    WHERE a->>'scheduledDate' = v_date::text AND COALESCE(a->>'status', '') <> 'cancelled'
      AND EXTRACT(HOUR FROM (a->>'scheduledTime')::time)::integer * 60 + EXTRACT(MINUTE FROM (a->>'scheduledTime')::time)::integer < v_end
      AND EXTRACT(HOUR FROM (a->>'scheduledTime')::time)::integer * 60 + EXTRACT(MINUTE FROM (a->>'scheduledTime')::time)::integer + COALESCE((a->>'durationMinutes')::integer, 30) > v_start
  ) THEN
    RETURN jsonb_build_object('success', false, 'message', 'Ese horario ya fue reservado. Elegi otro disponible.');
  END IF;
  SELECT COUNT(*) INTO v_count FROM (
    SELECT r.slot_time FROM public.public_booking_reservations r
      WHERE r.professional_id = v_professional AND r.slot_date = v_date
        AND r.block_id = v_block->>'id' AND r.status <> 'cancelled'
    UNION
    SELECT a->>'scheduledTime' FROM jsonb_array_elements(v_workspace) a
      WHERE a->>'scheduledDate' = v_date::text AND COALESCE(a->>'status', '') <> 'cancelled'
        AND (a->>'publicBookingBlockId' = v_block->>'id'
          OR (a->>'publicBookingBlockId' IS NULL AND a->>'publicBookingModality' = v_block->>'modality'
            AND v_block->>'id' = (SELECT value->>'id' FROM jsonb_array_elements(v_profile.availability_blocks) WHERE value->>'modality' = v_block->>'modality' LIMIT 1)))
  ) used_slots;
  v_quota := COALESCE((v_block->>'dailyQuota')::integer, (v_block->>'slotCount')::integer);
  IF v_count >= v_quota THEN
    RETURN jsonb_build_object('success', false, 'message', 'Ya no quedan cupos de esta turnera para ese dia.');
  END IF;
  INSERT INTO public.public_booking_reservations(
    professional_id, slug, slot_date, slot_time, block_id, modality, consultation_mode,
    patient_name, patient_dni, patient_email, patient_phone, appointment_id, status,
    amount_to_charge, amount_concept, payment_link, duration_minutes, block_label, location, reason
  ) VALUES (
    v_professional, v_profile.slug, v_date, p_reservation->>'slot_time', v_block->>'id', p_reservation->>'modality', p_reservation->>'consultation_mode',
    p_reservation->>'patient_name', p_reservation->>'patient_dni', p_reservation->>'patient_email', p_reservation->>'patient_phone',
    p_reservation->>'appointment_id', CASE WHEN v_amount > 0 THEN 'pending_payment' ELSE 'confirmed' END,
    v_amount, p_reservation->>'amount_concept', p_reservation->>'payment_link', v_duration, p_reservation->>'block_label', p_reservation->>'location', p_reservation->>'reason'
  );
  IF v_amount IS NULL THEN
    IF p_appointment IS NULL OR p_appointment->>'id' IS DISTINCT FROM p_reservation->>'appointment_id' THEN
      RAISE EXCEPTION 'Missing appointment for free booking';
    END IF;
    UPDATE public.user_workspaces SET appointments_json = v_workspace || jsonb_build_array(p_appointment), updated_at = NOW()
      WHERE user_id = v_professional;
  END IF;
  RETURN jsonb_build_object('success', true);
END;
$$;
REVOKE ALL ON FUNCTION public.reserve_public_booking(JSONB, JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_public_booking(JSONB, JSONB) TO service_role;
