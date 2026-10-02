CREATE OR REPLACE FUNCTION public.cancel_public_booking_appointment(
  p_professional_id text,
  p_appointment_id text
) RETURNS boolean
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_workspace public.user_workspaces%ROWTYPE;
  v_reservation public.public_booking_reservations%ROWTYPE;
  v_link_slot_id uuid;
BEGIN
  SELECT * INTO v_workspace FROM public.user_workspaces
  WHERE user_id = p_professional_id FOR UPDATE;
  IF NOT FOUND OR NOT EXISTS (
    SELECT 1 FROM jsonb_array_elements(COALESCE(v_workspace.appointments_json, '[]'::jsonb)) item
    WHERE item->>'id' = p_appointment_id
  ) THEN
    RETURN false;
  END IF;

  SELECT * INTO v_reservation FROM public.public_booking_reservations
  WHERE professional_id = p_professional_id AND appointment_id = p_appointment_id
  FOR UPDATE;

  SELECT s.id INTO v_link_slot_id FROM public.public_booking_slots s
  JOIN public.public_booking_links l ON l.id = s.link_id
  WHERE l.professional_id = p_professional_id AND s.appointment_id = p_appointment_id
  FOR UPDATE OF s;

  UPDATE public.user_workspaces SET appointments_json = (
    SELECT COALESCE(jsonb_agg(item ORDER BY ordinal), '[]'::jsonb)
    FROM jsonb_array_elements(COALESCE(v_workspace.appointments_json, '[]'::jsonb))
      WITH ORDINALITY AS appointments(item, ordinal)
    WHERE item->>'id' <> p_appointment_id
  ) WHERE user_id = p_professional_id;

  IF v_reservation.id IS NOT NULL THEN
    UPDATE public.public_booking_reservations SET status = 'cancelled'
    WHERE id = v_reservation.id;
  END IF;
  IF v_link_slot_id IS NOT NULL THEN
    UPDATE public.public_booking_slots SET is_booked = false, appointment_id = NULL,
      patient_name = NULL, patient_dni = NULL, patient_email = NULL,
      patient_phone = NULL, booked_at = NULL
    WHERE id = v_link_slot_id;
  END IF;
  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.cancel_public_booking_appointment(text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_public_booking_appointment(text, text) TO service_role;

CREATE OR REPLACE FUNCTION public.confirm_paid_public_booking(
  p_professional_id text,
  p_appointment_id text,
  p_patient jsonb,
  p_appointment jsonb,
  p_ledger jsonb
) RETURNS boolean
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_workspace public.user_workspaces%ROWTYPE;
  v_reservation public.public_booking_reservations%ROWTYPE;
  v_patient jsonb;
  v_patient_id text;
  v_patients jsonb;
  v_appointments jsonb;
  v_ledger jsonb;
BEGIN
  SELECT * INTO v_workspace FROM public.user_workspaces
  WHERE user_id = p_professional_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'La agenda del profesional no existe'; END IF;
  SELECT * INTO v_reservation FROM public.public_booking_reservations
  WHERE professional_id = p_professional_id AND appointment_id = p_appointment_id FOR UPDATE;
  IF NOT FOUND OR v_reservation.status = 'cancelled' THEN RETURN false; END IF;

  v_patients := COALESCE(v_workspace.patients_json, '[]'::jsonb);
  SELECT item INTO v_patient FROM jsonb_array_elements(v_patients) item
  WHERE regexp_replace(item->>'dni', '[^0-9]', '', 'g') = regexp_replace(v_reservation.patient_dni, '[^0-9]', '', 'g')
    AND regexp_replace(v_reservation.patient_dni, '[^0-9]', '', 'g') <> ''
  LIMIT 1;
  v_patient_id := COALESCE(v_patient->>'id', p_patient->>'id');
  IF v_patient IS NULL THEN v_patients := v_patients || p_patient; END IF;

  v_appointments := COALESCE(v_workspace.appointments_json, '[]'::jsonb);
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(v_appointments) item WHERE item->>'id' = p_appointment_id) THEN
    SELECT COALESCE(jsonb_agg(
      CASE WHEN item->>'id' = p_appointment_id
        THEN item || jsonb_build_object('patientId', v_patient_id,
          'status', CASE WHEN item->>'status' = 'attended' THEN 'attended' ELSE 'confirmed' END,
          'paymentStatus', 'approved', 'paymentId', p_appointment->>'paymentId')
        ELSE item END ORDER BY ordinal
    ), '[]'::jsonb) INTO v_appointments
    FROM jsonb_array_elements(v_appointments) WITH ORDINALITY AS appointments(item, ordinal);
  ELSE
    v_appointments := v_appointments || (p_appointment || jsonb_build_object('patientId', v_patient_id));
  END IF;

  v_ledger := COALESCE(v_workspace.treatment_ledger_json, '[]'::jsonb);
  IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_ledger) item WHERE item->>'id' = p_ledger->>'id') THEN
    v_ledger := v_ledger || (p_ledger || jsonb_build_object('patientId', v_patient_id));
  END IF;

  UPDATE public.user_workspaces SET patients_json = v_patients,
    appointments_json = v_appointments, treatment_ledger_json = v_ledger
  WHERE user_id = p_professional_id;
  UPDATE public.public_booking_reservations SET status = 'confirmed', payment_status = 'approved'
  WHERE id = v_reservation.id;
  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.confirm_paid_public_booking(text, text, jsonb, jsonb, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.confirm_paid_public_booking(text, text, jsonb, jsonb, jsonb) TO service_role;

CREATE OR REPLACE FUNCTION public.mark_public_booking_email_sent(
  p_professional_id text,
  p_appointment_id text,
  p_sent_at text
) RETURNS void
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_workspace public.user_workspaces%ROWTYPE;
BEGIN
  SELECT * INTO v_workspace FROM public.user_workspaces
  WHERE user_id = p_professional_id FOR UPDATE;
  IF NOT FOUND THEN RETURN; END IF;
  IF EXISTS (
    SELECT 1 FROM public.public_booking_reservations
    WHERE professional_id = p_professional_id AND appointment_id = p_appointment_id AND status = 'cancelled'
  ) THEN RETURN; END IF;
  UPDATE public.user_workspaces SET appointments_json = (
    SELECT COALESCE(jsonb_agg(
      CASE WHEN item->>'id' = p_appointment_id
        THEN item || jsonb_build_object('emailConfirmationSentAt', p_sent_at)
        ELSE item END ORDER BY ordinal
    ), '[]'::jsonb)
    FROM jsonb_array_elements(COALESCE(v_workspace.appointments_json, '[]'::jsonb))
      WITH ORDINALITY AS appointments(item, ordinal)
  ) WHERE user_id = p_professional_id;
END;
$$;

REVOKE ALL ON FUNCTION public.mark_public_booking_email_sent(text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mark_public_booking_email_sent(text, text, text) TO service_role;
