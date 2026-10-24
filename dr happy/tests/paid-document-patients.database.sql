BEGIN;
DO $$
DECLARE
  v_owner text := 'paid-chart-test-' || gen_random_uuid()::text;
  v_request uuid := gen_random_uuid();
  v_second uuid := gen_random_uuid();
  v_patient jsonb;
  v_result jsonb;
  v_count integer;
  v_ledger jsonb := '[{"id":"existing-payment","paidAmount":345}]'::jsonb;
BEGIN
  IF has_function_privilege('anon', 'public.ensure_paid_document_patient(text,uuid)', 'EXECUTE')
    OR has_function_privilege('authenticated', 'public.save_workspace_with_paid_patients(text,jsonb,jsonb)', 'EXECUTE') THEN
    RAISE EXCEPTION 'Patient RPCs must be service-only';
  END IF;
  INSERT INTO public.professionals(id,username,full_name,specialty,license_number,email,active,is_admin)
    VALUES(v_owner,v_owner,'Prueba fichas','Clinica','TEST',v_owner || '@example.invalid',true,false);
  INSERT INTO public.user_workspaces(user_id,profile_json,patients_json,appointments_json,treatment_ledger_json,treatment_ledger_initialized)
    VALUES(v_owner,'{}','[]','[]',v_ledger,true);
  INSERT INTO public.paid_clinical_document_requests(id,professional_id,tracking_token,service_type,requested_purpose,
    patient_first_name,patient_last_name,patient_dni,patient_email,patient_phone,patient_birth_date,
    patient_health_insurance,patient_insurance_member_number,reason,amount)
    VALUES(v_request,v_owner,encode(gen_random_bytes(32),'hex'),'certificate','Evaluacion',
      'Ana','Prueba','12345678','patient@example.invalid','11111111','1990-01-02','Cobertura','000123/45-A','Certificado laboral',30000);
  IF public.ensure_paid_document_patient(v_owner,v_request) IS NOT NULL
    OR (SELECT jsonb_array_length(patients_json) FROM public.user_workspaces WHERE user_id=v_owner) <> 0 THEN
    RAISE EXCEPTION 'Unpaid requests must not create charts';
  END IF;
  UPDATE public.paid_clinical_document_requests SET status='pending_review',payment_status='approved',payment_id=v_request::text,paid_at=now() WHERE id=v_request;
  SELECT patients_json->0 INTO v_patient FROM public.user_workspaces WHERE user_id=v_owner;
  IF v_patient->>'numeroAfiliado' <> '000123/45-A' OR v_patient->>'obraSocial' <> 'Cobertura'
    OR v_patient->>'dni' <> '12345678' OR v_patient->>'birthDate' <> '1990-01-02'
    OR v_patient->'consultations' <> '[]'::jsonb OR v_patient->>'ownerUserId' <> v_owner THEN
    RAISE EXCEPTION 'Approved payment must create an administrative chart, without inventing a consultation';
  END IF;
  IF public.ensure_paid_document_patient(v_owner || '-forged',v_request) IS NOT NULL THEN
    RAISE EXCEPTION 'Another owner must not obtain the chart';
  END IF;
  PERFORM public.ensure_paid_document_patient(v_owner,v_request);
  UPDATE public.user_workspaces SET patients_json=jsonb_build_array(v_patient || jsonb_build_object('dni','12.345.678','diagnosticoPrincipal','Conservar','certificates',jsonb_build_array(jsonb_build_object('id','certificate-existing')))) WHERE user_id=v_owner;
  INSERT INTO public.paid_clinical_document_requests(id,professional_id,tracking_token,service_type,requested_purpose,
    patient_first_name,patient_last_name,patient_dni,patient_email,patient_phone,patient_health_insurance,patient_insurance_member_number,
    reason,amount,status,payment_status)
    VALUES(v_second,v_owner,encode(gen_random_bytes(32),'hex'),'certificate','Evaluacion','Otro nombre','Otro apellido',
      '12345678','other@example.invalid','22222222','Otra cobertura','999','Otra solicitud',30000,'pending_review','approved');
  SELECT patients_json->0, jsonb_array_length(patients_json) INTO v_patient,v_count FROM public.user_workspaces WHERE user_id=v_owner;
  IF v_count <> 1 OR v_patient->>'nombre' <> 'Ana' OR v_patient->>'obraSocial' <> 'Cobertura'
    OR v_patient->>'numeroAfiliado' <> '000123/45-A' OR v_patient->>'diagnosticoPrincipal' <> 'Conservar'
    OR v_patient->'certificates'->0->>'id' <> 'certificate-existing' THEN
    RAISE EXCEPTION 'Normalized DNI deduplication must preserve existing identity, coverage and clinical history';
  END IF;
  IF (SELECT patient_id FROM public.paid_clinical_document_requests WHERE id=v_second)
    <> (SELECT patient_id FROM public.paid_clinical_document_requests WHERE id=v_request) THEN
    RAISE EXCEPTION 'Both requests must point to the same chart';
  END IF;
  PERFORM public.save_workspace_with_paid_patients(v_owner,'{"profile_json":{},"patients_json":[],"appointments_json":[]}', '[]');
  IF (SELECT jsonb_array_length(patients_json) FROM public.user_workspaces WHERE user_id=v_owner) <> 1 THEN
    RAISE EXCEPTION 'A stale client must not erase a chart created by a payment';
  END IF;
  IF (SELECT treatment_ledger_json FROM public.user_workspaces WHERE user_id=v_owner) <> v_ledger THEN
    RAISE EXCEPTION 'No second payment may be added to the ledger';
  END IF;
  PERFORM public.save_workspace_with_paid_patients(v_owner,'{"profile_json":{},"patients_json":[],"appointments_json":[]}',jsonb_build_array(v_patient->>'id'));
  IF (SELECT jsonb_array_length(patients_json) FROM public.user_workspaces WHERE user_id=v_owner) <> 0 THEN
    RAISE EXCEPTION 'Explicit deletion of a known chart must remain possible';
  END IF;
  UPDATE public.paid_clinical_document_requests SET status='completed',completed_at=now() WHERE id=v_request;
  v_result := public.ensure_paid_document_patient(v_owner,v_request);
  PERFORM public.ensure_paid_document_patient(v_owner,v_request);
  IF (SELECT jsonb_array_length(patients_json) FROM public.user_workspaces WHERE user_id=v_owner) <> 1
    OR (SELECT count(*) FROM public.paid_clinical_document_requests WHERE professional_id=v_owner AND payment_status='approved') <> 2
    OR (SELECT payment_id FROM public.paid_clinical_document_requests WHERE id=v_request) <> v_request::text THEN
    RAISE EXCEPTION 'Recovery and repeated callbacks must not duplicate charts or payments';
  END IF;
  v_patient := v_result->'patient';
  INSERT INTO public.dental_patient_archives(professional_id,patient_id,state,patient)
    VALUES(v_owner,v_patient->>'id','archived',v_patient);
  v_result := public.ensure_paid_document_patient(v_owner,v_request);
  IF v_result->>'archived' <> 'true' THEN RAISE EXCEPTION 'Archived chart must not be reactivated'; END IF;
  BEGIN
    UPDATE public.paid_clinical_document_requests SET patient_insurance_member_number=repeat('x',81) WHERE id=v_request;
    RAISE EXCEPTION 'Oversized member number accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
END $$;
ROLLBACK;
