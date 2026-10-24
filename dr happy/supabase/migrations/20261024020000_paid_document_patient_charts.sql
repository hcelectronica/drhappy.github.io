BEGIN;

ALTER TABLE public.paid_clinical_document_requests
  ADD COLUMN patient_health_insurance text CHECK (length(patient_health_insurance) <= 120),
  ADD COLUMN patient_insurance_member_number text CHECK (length(patient_insurance_member_number) <= 80),
  ADD COLUMN patient_id text;

CREATE INDEX paid_document_requests_patient ON public.paid_clinical_document_requests (professional_id, patient_id);

CREATE FUNCTION public.ensure_paid_document_patient(p_professional_id text, p_request_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_request public.paid_clinical_document_requests%ROWTYPE;
  v_workspace public.user_workspaces%ROWTYPE;
  v_patient jsonb;
  v_archive public.dental_patient_archives%ROWTYPE;
  v_patients jsonb;
  v_patch jsonb := '{}'::jsonb;
  v_dni text;
  v_now text := to_char(clock_timestamp() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
BEGIN
  SELECT * INTO v_request FROM public.paid_clinical_document_requests
    WHERE id = p_request_id AND professional_id = p_professional_id FOR UPDATE;
  IF NOT FOUND OR v_request.payment_status <> 'approved' OR v_request.status NOT IN ('pending_review', 'completed') THEN
    RETURN NULL;
  END IF;
  SELECT * INTO v_workspace FROM public.user_workspaces WHERE user_id = p_professional_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'No existe la base personal del profesional'; END IF;
  v_dni := regexp_replace(v_request.patient_dni, '[^0-9]', '', 'g');
  IF v_dni = '' THEN RAISE EXCEPTION 'La solicitud no tiene un DNI valido'; END IF;

  SELECT * INTO v_archive FROM public.dental_patient_archives
    WHERE professional_id = p_professional_id AND state <> 'active'
    AND (patient_id = v_request.patient_id OR regexp_replace(patient->>'dni', '[^0-9]', '', 'g') = v_dni)
    LIMIT 1;
  IF FOUND THEN
    UPDATE public.paid_clinical_document_requests SET patient_id = v_archive.patient_id WHERE id = p_request_id;
    RETURN jsonb_build_object('patient', v_archive.patient, 'archived', true);
  END IF;

  v_patients := coalesce(v_workspace.patients_json, '[]'::jsonb);
  SELECT value INTO v_patient FROM jsonb_array_elements(v_patients)
    WHERE value->>'id' = v_request.patient_id OR regexp_replace(value->>'dni', '[^0-9]', '', 'g') = v_dni
    ORDER BY (value->>'id' = v_request.patient_id) DESC NULLS LAST LIMIT 1;
  IF v_patient IS NULL THEN
    v_patient := jsonb_build_object(
      'id', gen_random_uuid()::text, 'ownerUserId', p_professional_id,
      'nombre', v_request.patient_first_name, 'apellido', v_request.patient_last_name, 'dni', v_dni,
      'email', v_request.patient_email, 'telefono', v_request.patient_phone,
      'birthDate', coalesce(v_request.patient_birth_date::text, ''),
      'edad', CASE WHEN v_request.patient_birth_date IS NULL THEN '' ELSE extract(year FROM age(current_date, v_request.patient_birth_date))::text END,
      'obraSocial', coalesce(v_request.patient_health_insurance, ''),
      'numeroAfiliado', coalesce(v_request.patient_insurance_member_number, ''),
      'plan', '', 'direccion', '', 'diagnosticoPrincipal', '', 'patologiasConocidas', '',
      'patologiasCronicas', '', 'ultimaInternacion', '', 'cirugiasPrevias', '',
      'documents', '[]'::jsonb, 'consultations', '[]'::jsonb, 'certificates', '[]'::jsonb,
      'createdAt', v_now, 'updatedAt', v_now);
    v_patients := v_patients || jsonb_build_array(v_patient);
  ELSE
    IF coalesce(v_patient->>'obraSocial', '') = '' AND coalesce(v_request.patient_health_insurance, '') <> '' THEN
      v_patch := v_patch || jsonb_build_object('obraSocial', v_request.patient_health_insurance);
    END IF;
    IF coalesce(v_patient->>'numeroAfiliado', '') = '' AND coalesce(v_request.patient_insurance_member_number, '') <> '' THEN
      v_patch := v_patch || jsonb_build_object('numeroAfiliado', v_request.patient_insurance_member_number);
    END IF;
    IF coalesce(v_patient->>'email', '') = '' THEN v_patch := v_patch || jsonb_build_object('email', v_request.patient_email); END IF;
    IF coalesce(v_patient->>'telefono', '') = '' THEN v_patch := v_patch || jsonb_build_object('telefono', v_request.patient_phone); END IF;
    IF v_patch <> '{}'::jsonb THEN
      v_patient := v_patient || v_patch || jsonb_build_object('updatedAt', v_now);
      SELECT jsonb_agg(CASE WHEN value->>'id' = v_patient->>'id' THEN v_patient ELSE value END ORDER BY ordinal)
        INTO v_patients FROM jsonb_array_elements(v_patients) WITH ORDINALITY a(value, ordinal);
    END IF;
  END IF;
  IF v_patients IS DISTINCT FROM v_workspace.patients_json THEN
    UPDATE public.user_workspaces SET patients_json = v_patients WHERE user_id = p_professional_id;
  END IF;
  UPDATE public.paid_clinical_document_requests SET patient_id = v_patient->>'id' WHERE id = p_request_id;
  RETURN jsonb_build_object('patient', v_patient, 'archived', false);
END;
$$;

REVOKE ALL ON FUNCTION public.ensure_paid_document_patient(text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ensure_paid_document_patient(text, uuid) TO service_role;

CREATE FUNCTION public.paid_document_create_patient() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  PERFORM public.ensure_paid_document_patient(NEW.professional_id, NEW.id);
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.paid_document_create_patient() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER paid_document_create_patient
AFTER INSERT OR UPDATE OF payment_status, status ON public.paid_clinical_document_requests
FOR EACH ROW WHEN (NEW.payment_status = 'approved' AND NEW.status IN ('pending_review', 'completed'))
EXECUTE FUNCTION public.paid_document_create_patient();

-- Keep charts received since the client's last snapshot, but allow explicit deletion of known charts.
CREATE FUNCTION public.save_workspace_with_paid_patients(p_professional_id text, p_workspace jsonb, p_known_patient_ids jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_workspace public.user_workspaces%ROWTYPE;
  v_patients jsonb := coalesce(p_workspace->'patients_json', '[]'::jsonb);
  v_patient jsonb;
BEGIN
  IF jsonb_typeof(v_patients) <> 'array' OR jsonb_typeof(p_known_patient_ids) <> 'array' THEN
    RAISE EXCEPTION 'La lista de pacientes no es valida';
  END IF;
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
  INSERT INTO public.user_workspaces(user_id, profile_json, patients_json, appointments_json, treatment_ledger_json, treatment_ledger_initialized)
  VALUES (p_professional_id, coalesce(p_workspace->'profile_json','{}'::jsonb), v_patients,
    coalesce(p_workspace->'appointments_json','[]'::jsonb),
    coalesce(p_workspace->'treatment_ledger_json', v_workspace.treatment_ledger_json, '[]'::jsonb),
    coalesce((p_workspace->>'treatment_ledger_initialized')::boolean, v_workspace.treatment_ledger_initialized, false))
  ON CONFLICT (user_id) DO UPDATE SET profile_json = EXCLUDED.profile_json, patients_json = EXCLUDED.patients_json,
    appointments_json = EXCLUDED.appointments_json, treatment_ledger_json = EXCLUDED.treatment_ledger_json,
    treatment_ledger_initialized = EXCLUDED.treatment_ledger_initialized;
END;
$$;
REVOKE ALL ON FUNCTION public.save_workspace_with_paid_patients(text, jsonb, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.save_workspace_with_paid_patients(text, jsonb, jsonb) TO service_role;

COMMIT;
