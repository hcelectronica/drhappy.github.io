CREATE OR REPLACE FUNCTION public.save_workspace_with_paid_patients(
  p_professional_id text, p_workspace jsonb, p_known_patient_ids jsonb
)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_workspace public.user_workspaces%ROWTYPE;
  v_patients jsonb := coalesce(p_workspace->'patients_json', '[]'::jsonb);
  v_appointments jsonb := coalesce(p_workspace->'appointments_json', '[]'::jsonb);
  v_patient jsonb;
  v_current jsonb;
  v_merged jsonb := '[]'::jsonb;
  v_item jsonb;
  v_reservation public.public_booking_reservations%ROWTYPE;
BEGIN
  IF jsonb_typeof(v_patients) <> 'array' OR jsonb_typeof(p_known_patient_ids) <> 'array'
    OR jsonb_typeof(v_appointments) <> 'array' THEN
    RAISE EXCEPTION 'Las listas del espacio de trabajo no son validas';
  END IF;
  INSERT INTO public.user_workspaces(user_id) VALUES (p_professional_id) ON CONFLICT (user_id) DO NOTHING;
  SELECT * INTO v_workspace FROM public.user_workspaces WHERE user_id = p_professional_id FOR UPDATE;
  FOR v_patient IN SELECT value FROM jsonb_array_elements(coalesce(v_workspace.patients_json, '[]'::jsonb)) LOOP
    IF NOT p_known_patient_ids ? (v_patient->>'id')
      AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_patients) WHERE value->>'id' = v_patient->>'id')
      AND EXISTS (SELECT 1 FROM public.paid_clinical_document_requests
        WHERE professional_id = p_professional_id AND patient_id = v_patient->>'id' AND payment_status = 'approved')
    THEN
      v_patients := v_patients || jsonb_build_array(v_patient);
    END IF;
  END LOOP;

  FOR v_item IN SELECT value FROM jsonb_array_elements(v_appointments) LOOP
    SELECT * INTO v_reservation FROM public.public_booking_reservations
      WHERE professional_id = p_professional_id AND appointment_id = v_item->>'id';
    IF FOUND AND v_reservation.status = 'cancelled' THEN
      CONTINUE;
    END IF;
    SELECT value INTO v_current FROM jsonb_array_elements(coalesce(v_workspace.appointments_json, '[]'::jsonb))
      WHERE value->>'id' = v_item->>'id' LIMIT 1;
    IF v_current IS NOT NULL AND v_reservation.id IS NOT NULL THEN
      v_item := v_current || v_item;
      IF v_reservation.payment_status = 'approved' THEN
        v_item := v_item || jsonb_build_object(
          'paymentStatus', 'approved',
          'paymentId', coalesce(v_current->>'paymentId', v_item->>'paymentId'),
          'status', CASE WHEN v_item->>'status' = 'attended' OR v_current->>'status' = 'attended'
            THEN 'attended' ELSE 'confirmed' END
        );
      END IF;
      IF v_current ? 'emailConfirmationSentAt' THEN
        v_item := jsonb_set(v_item, '{emailConfirmationSentAt}', v_current->'emailConfirmationSentAt');
      END IF;
    END IF;
    v_merged := v_merged || jsonb_build_array(v_item);
  END LOOP;

  FOR v_current IN SELECT value FROM jsonb_array_elements(coalesce(v_workspace.appointments_json, '[]'::jsonb)) LOOP
    IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_merged) a WHERE a->>'id' = v_current->>'id')
      AND EXISTS (SELECT 1 FROM public.public_booking_reservations r
        WHERE r.professional_id = p_professional_id AND r.appointment_id = v_current->>'id' AND r.status = 'confirmed')
    THEN
      v_merged := v_merged || jsonb_build_array(v_current);
    END IF;
  END LOOP;

  INSERT INTO public.user_workspaces(user_id, profile_json, patients_json, appointments_json, treatment_ledger_json, treatment_ledger_initialized)
  VALUES (p_professional_id, coalesce(p_workspace->'profile_json','{}'::jsonb), v_patients, v_merged,
    coalesce(p_workspace->'treatment_ledger_json', v_workspace.treatment_ledger_json, '[]'::jsonb),
    coalesce((p_workspace->>'treatment_ledger_initialized')::boolean, v_workspace.treatment_ledger_initialized, false))
  ON CONFLICT (user_id) DO UPDATE SET profile_json = EXCLUDED.profile_json, patients_json = EXCLUDED.patients_json,
    appointments_json = EXCLUDED.appointments_json, treatment_ledger_json = EXCLUDED.treatment_ledger_json,
    treatment_ledger_initialized = EXCLUDED.treatment_ledger_initialized;
END;
$$;

ALTER TABLE public.public_booking_reservations
  ADD COLUMN confirmation_email_status text,
  ADD COLUMN confirmation_email_claimed_at timestamptz,
  ADD COLUMN professional_confirmation_status text,
  ADD COLUMN professional_confirmation_claimed_at timestamptz;

UPDATE public.public_booking_reservations
SET confirmation_email_status = CASE WHEN status = 'pending_payment' THEN 'pending' ELSE 'legacy_unknown' END;

UPDATE public.public_booking_reservations
SET professional_confirmation_status = CASE WHEN status = 'pending_payment' THEN 'pending' ELSE 'legacy_unknown' END;

ALTER TABLE public.public_booking_reservations
  ALTER COLUMN confirmation_email_status SET DEFAULT 'pending',
  ALTER COLUMN confirmation_email_status SET NOT NULL,
  ALTER COLUMN professional_confirmation_status SET DEFAULT 'pending',
  ALTER COLUMN professional_confirmation_status SET NOT NULL,
  ADD CONSTRAINT public_booking_confirmation_email_status_check
    CHECK (confirmation_email_status IN ('pending', 'sending', 'sent', 'failed', 'legacy_unknown')),
  ADD CONSTRAINT public_booking_professional_confirmation_status_check
    CHECK (professional_confirmation_status IN ('pending', 'sending', 'sent', 'failed', 'legacy_unknown'));
