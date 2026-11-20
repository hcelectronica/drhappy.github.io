CREATE TABLE public.ioma_prescription_settings (
  professional_id text PRIMARY KEY REFERENCES public.professionals(id) ON DELETE CASCADE,
  enabled boolean NOT NULL DEFAULT false
);

CREATE TABLE public.ioma_prescription_requests (
  id uuid PRIMARY KEY,
  professional_id text NOT NULL REFERENCES public.professionals(id) ON DELETE CASCADE,
  patient_id text NOT NULL,
  patient_first_name text NOT NULL,
  patient_last_name text NOT NULL,
  patient_dni text NOT NULL,
  patient_email text NOT NULL,
  patient_phone text NOT NULL,
  patient_birth_date date NOT NULL,
  insurance_member_number text NOT NULL,
  medication text NOT NULL,
  status text NOT NULL DEFAULT 'pending_review' CHECK (status IN ('pending_review', 'completed')),
  email_status text NOT NULL DEFAULT 'pending' CHECK (email_status IN ('pending', 'sent', 'failed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);
CREATE INDEX ioma_requests_professional_created ON public.ioma_prescription_requests(professional_id, created_at DESC);

ALTER TABLE public.ioma_prescription_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ioma_prescription_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ioma_prescription_settings, public.ioma_prescription_requests FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.ioma_prescription_settings, public.ioma_prescription_requests TO service_role;

CREATE FUNCTION public.create_ioma_prescription_request(p_professional_id text, p_request jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_workspace public.user_workspaces%ROWTYPE;
  v_patient jsonb;
  v_patients jsonb;
  v_id uuid := (p_request->>'id')::uuid;
  v_dni text := p_request->>'patientDni';
  v_now text := to_char(clock_timestamp() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.ioma_prescription_settings WHERE professional_id = p_professional_id AND enabled) THEN
    RAISE EXCEPTION 'Servicio no habilitado';
  END IF;
  IF v_dni !~ '^[0-9]{6,9}$' OR coalesce(length(trim(p_request->>'patientFirstName')),0) NOT BETWEEN 1 AND 80
    OR coalesce(length(trim(p_request->>'patientLastName')),0) NOT BETWEEN 1 AND 80
    OR coalesce(length(trim(p_request->>'medication')),0) NOT BETWEEN 2 AND 2000
    OR coalesce(length(trim(p_request->>'insuranceMemberNumber')),0) NOT BETWEEN 1 AND 80
    OR p_request->>'patientEmail' !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
    OR coalesce(length(p_request->>'patientPhone'),0) NOT BETWEEN 8 AND 30
  THEN RAISE EXCEPTION 'Datos de solicitud invalidos'; END IF;
  INSERT INTO public.user_workspaces(user_id) VALUES(p_professional_id) ON CONFLICT (user_id) DO NOTHING;
  SELECT * INTO STRICT v_workspace FROM public.user_workspaces WHERE user_id = p_professional_id FOR UPDATE;
  IF (SELECT count(*) FROM public.ioma_prescription_requests WHERE professional_id = p_professional_id
    AND created_at >= now() - interval '1 hour') >= 20 THEN
    RAISE EXCEPTION 'Limite de solicitudes alcanzado';
  END IF;
  IF EXISTS (SELECT 1 FROM public.dental_patient_archives WHERE professional_id = p_professional_id AND state <> 'active'
    AND regexp_replace(patient->>'dni','[^0-9]','','g') = v_dni) THEN
    RAISE EXCEPTION 'La ficha requiere revision por el profesional';
  END IF;
  v_patients := coalesce(v_workspace.patients_json, '[]'::jsonb);
  SELECT value INTO v_patient FROM jsonb_array_elements(v_patients)
    WHERE regexp_replace(value->>'dni','[^0-9]','','g') = v_dni LIMIT 1;
  IF v_patient IS NULL THEN
    v_patient := jsonb_build_object(
      'id',gen_random_uuid()::text,'ownerUserId',p_professional_id,'nombre',p_request->>'patientFirstName',
      'apellido',p_request->>'patientLastName','dni',v_dni,'email',p_request->>'patientEmail',
      'telefono',p_request->>'patientPhone','birthDate',p_request->>'birthDate',
      'edad',extract(year FROM age(current_date,(p_request->>'birthDate')::date))::text,
      'obraSocial','IOMA','numeroAfiliado',p_request->>'insuranceMemberNumber','plan','','direccion','',
      'diagnosticoPrincipal','','patologiasConocidas','','patologiasCronicas','','ultimaInternacion','',
      'cirugiasPrevias','','documents','[]'::jsonb,'consultations','[]'::jsonb,'certificates','[]'::jsonb,
      'createdAt',v_now,'updatedAt',v_now);
    v_patients := v_patients || jsonb_build_array(v_patient);
    UPDATE public.user_workspaces SET patients_json = v_patients WHERE user_id = p_professional_id;
  END IF;
  INSERT INTO public.ioma_prescription_requests(id,professional_id,patient_id,patient_first_name,patient_last_name,
    patient_dni,patient_email,patient_phone,patient_birth_date,insurance_member_number,medication)
  VALUES(v_id,p_professional_id,v_patient->>'id',p_request->>'patientFirstName',p_request->>'patientLastName',
    v_dni,p_request->>'patientEmail',p_request->>'patientPhone',(p_request->>'birthDate')::date,
    p_request->>'insuranceMemberNumber',p_request->>'medication');
  RETURN v_id;
END $$;
REVOKE ALL ON FUNCTION public.create_ioma_prescription_request(text,jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_ioma_prescription_request(text,jsonb) TO service_role;

CREATE FUNCTION public.complete_ioma_prescription_request(p_professional_id text, p_request_id uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_request public.ioma_prescription_requests%ROWTYPE;
  v_workspace public.user_workspaces%ROWTYPE;
  v_patient jsonb;
  v_entry jsonb;
  v_now text := to_char(clock_timestamp() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
BEGIN
  SELECT * INTO v_request FROM public.ioma_prescription_requests
    WHERE id = p_request_id AND professional_id = p_professional_id FOR UPDATE;
  IF NOT FOUND THEN RETURN false; END IF;
  IF v_request.status = 'completed' THEN RETURN true; END IF;
  SELECT * INTO STRICT v_workspace FROM public.user_workspaces WHERE user_id = p_professional_id FOR UPDATE;
  SELECT value INTO v_patient FROM jsonb_array_elements(coalesce(v_workspace.patients_json,'[]'::jsonb))
    WHERE value->>'id' = v_request.patient_id LIMIT 1;
  IF v_patient IS NULL THEN RAISE EXCEPTION 'La ficha del paciente no esta disponible'; END IF;
  v_entry := jsonb_build_object('id','ioma-' || p_request_id::text,'date',v_now,
    'motivoConsulta','Receta digital IOMA','detalleAtencion','Receta gestionada fuera de Dr Happy. Medicación solicitada: ' || v_request.medication,
    'pensamientoMedico','','professionalSignature',jsonb_build_object(
      'fullName',coalesce(v_workspace.profile_json->>'fullName',''),
      'licenseNumber',coalesce(v_workspace.profile_json->>'licenseNumber',''),
      'signatureText',coalesce(v_workspace.profile_json->>'signatureText','')));
  UPDATE public.user_workspaces SET patients_json = (
    SELECT jsonb_agg(CASE WHEN value->>'id' = v_request.patient_id THEN
      value || jsonb_build_object('consultations',jsonb_build_array(v_entry) || coalesce(value->'consultations','[]'::jsonb),'updatedAt',v_now)
      ELSE value END ORDER BY ordinal)
    FROM jsonb_array_elements(patients_json) WITH ORDINALITY a(value,ordinal)
  ) WHERE user_id = p_professional_id;
  UPDATE public.ioma_prescription_requests SET status='completed',completed_at=now() WHERE id=p_request_id;
  RETURN true;
END $$;
REVOKE ALL ON FUNCTION public.complete_ioma_prescription_request(text,uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.complete_ioma_prescription_request(text,uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.save_workspace_with_paid_patients(
  p_professional_id text, p_workspace jsonb, p_known_patient_ids jsonb
)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_workspace public.user_workspaces%ROWTYPE;
  v_patients jsonb := coalesce(p_workspace->'patients_json', '[]'::jsonb);
  v_appointments jsonb := coalesce(p_workspace->'appointments_json', '[]'::jsonb);
  v_patient jsonb;
  v_incoming jsonb;
  v_consultation jsonb;
  v_consultations jsonb;
  v_current jsonb;
  v_merged jsonb := '[]'::jsonb;
  v_item jsonb;
  v_reservation public.public_booking_reservations%ROWTYPE;
BEGIN
  IF jsonb_typeof(v_patients) <> 'array' OR jsonb_typeof(p_known_patient_ids) <> 'array'
    OR jsonb_typeof(v_appointments) <> 'array' THEN RAISE EXCEPTION 'Las listas del espacio de trabajo no son validas'; END IF;
  INSERT INTO public.user_workspaces(user_id) VALUES (p_professional_id) ON CONFLICT (user_id) DO NOTHING;
  SELECT * INTO v_workspace FROM public.user_workspaces WHERE user_id = p_professional_id FOR UPDATE;
  FOR v_patient IN SELECT value FROM jsonb_array_elements(coalesce(v_workspace.patients_json, '[]'::jsonb)) LOOP
    SELECT value INTO v_incoming FROM jsonb_array_elements(v_patients) WHERE value->>'id'=v_patient->>'id' LIMIT 1;
    IF v_incoming IS NULL AND NOT p_known_patient_ids ? (v_patient->>'id')
      AND (EXISTS (SELECT 1 FROM public.paid_clinical_document_requests WHERE professional_id=p_professional_id
        AND patient_id=v_patient->>'id' AND payment_status='approved')
        OR EXISTS (SELECT 1 FROM public.ioma_prescription_requests WHERE professional_id=p_professional_id AND patient_id=v_patient->>'id')) THEN
      v_patients := v_patients || jsonb_build_array(v_patient);
    ELSIF v_incoming IS NOT NULL THEN
      v_consultations := coalesce(v_incoming->'consultations','[]'::jsonb);
      FOR v_consultation IN SELECT value FROM jsonb_array_elements(coalesce(v_patient->'consultations','[]'::jsonb)) LOOP
        IF EXISTS (SELECT 1 FROM public.ioma_prescription_requests r WHERE r.professional_id=p_professional_id
          AND r.patient_id=v_patient->>'id' AND r.status='completed' AND 'ioma-' || r.id::text=v_consultation->>'id')
          AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_consultations) c WHERE c->>'id'=v_consultation->>'id') THEN
          v_consultations := v_consultations || jsonb_build_array(v_consultation);
        END IF;
      END LOOP;
      IF v_consultations IS DISTINCT FROM coalesce(v_incoming->'consultations','[]'::jsonb) THEN
        SELECT jsonb_agg(CASE WHEN value->>'id'=v_patient->>'id' THEN jsonb_set(value,'{consultations}',v_consultations)
          ELSE value END ORDER BY ordinal) INTO v_patients FROM jsonb_array_elements(v_patients) WITH ORDINALITY a(value,ordinal);
      END IF;
    END IF;
  END LOOP;
  FOR v_item IN SELECT value FROM jsonb_array_elements(v_appointments) LOOP
    SELECT * INTO v_reservation FROM public.public_booking_reservations
      WHERE professional_id=p_professional_id AND appointment_id=v_item->>'id';
    IF FOUND AND v_reservation.status='cancelled' THEN CONTINUE; END IF;
    SELECT value INTO v_current FROM jsonb_array_elements(coalesce(v_workspace.appointments_json,'[]'::jsonb))
      WHERE value->>'id'=v_item->>'id' LIMIT 1;
    IF v_current IS NOT NULL AND v_reservation.id IS NOT NULL THEN
      v_item := v_current || v_item;
      IF v_reservation.payment_status='approved' THEN
        v_item := v_item || jsonb_build_object('paymentStatus','approved','paymentId',coalesce(v_current->>'paymentId',v_item->>'paymentId'),
          'status',CASE WHEN v_item->>'status'='attended' OR v_current->>'status'='attended' THEN 'attended' ELSE 'confirmed' END);
      END IF;
      IF v_current ? 'emailConfirmationSentAt' THEN v_item := jsonb_set(v_item,'{emailConfirmationSentAt}',v_current->'emailConfirmationSentAt'); END IF;
    END IF;
    v_merged := v_merged || jsonb_build_array(v_item);
  END LOOP;
  FOR v_current IN SELECT value FROM jsonb_array_elements(coalesce(v_workspace.appointments_json,'[]'::jsonb)) LOOP
    IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_merged) a WHERE a->>'id'=v_current->>'id')
      AND EXISTS (SELECT 1 FROM public.public_booking_reservations r WHERE r.professional_id=p_professional_id
        AND r.appointment_id=v_current->>'id' AND r.status='confirmed') THEN
      v_merged := v_merged || jsonb_build_array(v_current);
    END IF;
  END LOOP;
  UPDATE public.user_workspaces SET profile_json=coalesce(p_workspace->'profile_json','{}'::jsonb), patients_json=v_patients,
    appointments_json=v_merged, treatment_ledger_json=coalesce(p_workspace->'treatment_ledger_json',v_workspace.treatment_ledger_json,'[]'::jsonb),
    treatment_ledger_initialized=coalesce((p_workspace->>'treatment_ledger_initialized')::boolean,v_workspace.treatment_ledger_initialized,false)
  WHERE user_id=p_professional_id;
END $$;
