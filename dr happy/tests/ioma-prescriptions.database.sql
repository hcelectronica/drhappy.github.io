DO $$
DECLARE
  v_professional text := gen_random_uuid()::text;
  v_other text := gen_random_uuid()::text;
  v_id uuid := gen_random_uuid();
  v_id2 uuid := gen_random_uuid();
  v_patient text;
  v_result jsonb;
  v_request jsonb;
BEGIN
  INSERT INTO public.professionals(id,username,full_name,specialty,license_number,email)
    VALUES(v_professional,'fixture-' || v_professional,'Fixture','Test','TEST',v_professional || '@example.invalid'),
      (v_other,'fixture-' || v_other,'Fixture','Test','TEST',v_other || '@example.invalid');
  INSERT INTO public.ioma_prescription_settings(professional_id,enabled) VALUES(v_professional,true);
  v_request := jsonb_build_object('id',v_id,'patientFirstName','Paciente','patientLastName','Fixture',
    'patientDni','12345678','patientEmail','fixture@example.invalid','patientPhone','11111111',
    'birthDate','1990-01-01','insuranceMemberNumber','123456','medication','Medicación de prueba');
  BEGIN
    PERFORM public.create_ioma_prescription_request(v_other,v_request);
    RAISE EXCEPTION 'A professional without the service accepted a request';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'Servicio no habilitado' THEN RAISE; END IF;
  END;
  PERFORM public.create_ioma_prescription_request(v_professional,v_request);
  SELECT patient_id INTO v_patient FROM public.ioma_prescription_requests WHERE id=v_id;
  IF v_patient IS NULL THEN RAISE EXCEPTION 'Missing patient'; END IF;
  PERFORM public.save_workspace_with_paid_patients(v_professional,'{"profile_json":{},"patients_json":[],"appointments_json":[]}'::jsonb,'[]');
  SELECT patients_json INTO v_result FROM public.user_workspaces WHERE user_id=v_professional;
  IF NOT v_result @> jsonb_build_array(jsonb_build_object('id',v_patient)) THEN RAISE EXCEPTION 'Stale save erased new patient'; END IF;
  PERFORM public.create_ioma_prescription_request(v_professional,v_request || jsonb_build_object('id',v_id2));
  IF (SELECT patient_id FROM public.ioma_prescription_requests WHERE id=v_id2) <> v_patient THEN RAISE EXCEPTION 'Duplicate patient'; END IF;
  IF public.complete_ioma_prescription_request(v_other,v_id) THEN RAISE EXCEPTION 'Other professional completed request'; END IF;
  IF NOT public.complete_ioma_prescription_request(v_professional,v_id) THEN RAISE EXCEPTION 'Completion failed'; END IF;
  IF NOT public.complete_ioma_prescription_request(v_professional,v_id) THEN RAISE EXCEPTION 'Repeated completion failed'; END IF;
  SELECT patients_json INTO v_result FROM public.user_workspaces WHERE user_id=v_professional;
  IF (SELECT count(*) FROM jsonb_array_elements(v_result) p, jsonb_array_elements(p->'consultations') c
    WHERE c->>'id'='ioma-' || v_id::text) <> 1 THEN RAISE EXCEPTION 'Missing or duplicated clinical entry'; END IF;
  PERFORM public.save_workspace_with_paid_patients(v_professional,
    jsonb_build_object('patients_json',jsonb_build_array(jsonb_build_object('id',v_patient,'consultations','[]'::jsonb)),
      'appointments_json','[]'::jsonb,'profile_json','{}'::jsonb),jsonb_build_array(v_patient));
  SELECT patients_json INTO v_result FROM public.user_workspaces WHERE user_id=v_professional;
  IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_result) p, jsonb_array_elements(p->'consultations') c
    WHERE c->>'id'='ioma-' || v_id::text) THEN RAISE EXCEPTION 'Stale save erased IOMA clinical entry'; END IF;
  IF EXISTS (SELECT 1 FROM information_schema.role_table_grants WHERE grantee IN ('anon','authenticated')
    AND table_schema='public' AND table_name IN ('ioma_prescription_requests','ioma_prescription_settings')) THEN RAISE EXCEPTION 'Public access to IOMA requests'; END IF;
END $$;
