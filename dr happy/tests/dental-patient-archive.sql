BEGIN;
DO $test$
DECLARE
  v_id text := gen_random_uuid()::text;
  v_other text := gen_random_uuid()::text;
  v_doctor text := gen_random_uuid()::text;
  v_record jsonb := '{
    "version":1,"patient":{"name":"Ana Test","dni":"12345678","address":"","phone":"",
      "locality":"","coverage":"","email":"test@example.invalid","birthDate":"","memberNumber":""},
    "status":"confirmed","marks":[],"observations":"Atencion de prueba",
    "treatments":[{"id":"t1","date":"2026-10-04","tooth":11,"surface":"mesial","work":"Restauracion",
      "budgetCents":10000,"internalCostCents":2500,"status":"accepted","acceptedDate":"2026-10-04"}],
    "payments":[{"id":"pay1","treatmentId":"t1","date":"2026-10-04","amountCents":3000,"method":"Efectivo"}],
    "coverageNotes":"","consentNotes":""}';
  v_before jsonb;
  v_after jsonb;
  v_history integer;
  v_rejected boolean;
BEGIN
  INSERT INTO public.professionals(id,username,full_name,specialty,license_number,email,active)
    VALUES (v_id,'archive-test-'||v_id,'Archive Test','Odontologia','TEST',v_id||'@example.invalid',true),
      (v_other,'archive-test-'||v_other,'Other Test','Odontologia','TEST',v_other||'@example.invalid',true),
      (v_doctor,'archive-test-'||v_doctor,'Doctor Test','Clinica','TEST',v_doctor||'@example.invalid',true);
  INSERT INTO public.user_workspaces(user_id,patients_json)
    VALUES (v_id,jsonb_build_array(jsonb_build_object('id','p1','ownerUserId',v_id,'nombre','Ana','apellido','Test',
      'dni','12345678','documents',jsonb_build_array(jsonb_build_object('id','document')),
      'consultations',jsonb_build_array(jsonb_build_object('id','consultation'))))),
      (v_other,'[]'),(v_doctor,jsonb_build_array(jsonb_build_object('id','p1','ownerUserId',v_doctor)));
  v_before := public.dental_save(v_id,'p1',v_record,0,true);
  SELECT count(*) INTO v_history FROM public.dental_record_history WHERE professional_id = v_id;
  v_rejected := false;
  BEGIN PERFORM public.dental_archive_patient(v_other,'p1','archive');
  EXCEPTION WHEN no_data_found THEN v_rejected := true; END;
  ASSERT v_rejected, 'Rejects a patient owned by another professional';
  v_rejected := false;
  BEGIN PERFORM public.dental_archive_patient(v_doctor,'p1','archive');
  EXCEPTION WHEN insufficient_privilege THEN v_rejected := true; END;
  ASSERT v_rejected, 'Rejects non dentists';
  v_rejected := false;
  BEGIN PERFORM public.dental_archive_patient(v_id,'p1','confirm');
  EXCEPTION WHEN invalid_parameter_value THEN v_rejected := true; END;
  ASSERT v_rejected, 'Cannot skip the first stage';

  UPDATE public.user_workspaces SET appointments_json = jsonb_build_array(jsonb_build_object('id','future',
    'patientDni','12.345.678','status','confirmed','scheduledDate',(current_date+2)::text,'scheduledTime','10:00'))
    WHERE user_id = v_id;
  v_rejected := false;
  BEGIN PERFORM public.dental_archive_patient(v_id,'p1','archive');
  EXCEPTION WHEN invalid_parameter_value THEN v_rejected := true; END;
  ASSERT v_rejected, 'Future appointment by normalized DNI blocks archival';
  UPDATE public.user_workspaces SET appointments_json = '[]' WHERE user_id = v_id;
  INSERT INTO public.public_booking_reservations(professional_id,slug,slot_date,slot_time,block_id,modality,
    patient_name,patient_dni,patient_email,patient_phone,appointment_id,status)
    VALUES (v_id,'archive-test',current_date+2,'10:00','test','private','Ana Test','12.345.678',
      'test@example.invalid','12345678','reservation-test','pending_payment');
  v_rejected := false;
  BEGIN PERFORM public.dental_archive_patient(v_id,'p1','archive');
  EXCEPTION WHEN invalid_parameter_value THEN v_rejected := true; END;
  ASSERT v_rejected, 'Public booking pending payment also blocks archival';
  UPDATE public.public_booking_reservations SET status = 'cancelled' WHERE professional_id = v_id;
  PERFORM public.dental_archive_patient(v_id,'p1','archive');
  ASSERT (SELECT state FROM public.dental_patient_archives WHERE professional_id = v_id AND patient_id = 'p1') = 'archived';
  v_rejected := false;
  BEGIN PERFORM public.dental_archive_patient(v_id,'p1','archive');
  EXCEPTION WHEN invalid_parameter_value THEN v_rejected := true; END;
  ASSERT v_rejected, 'Repeated archive rejected';

  UPDATE public.user_workspaces SET patients_json = '[]', treatment_ledger_json = '[]' WHERE user_id = v_id;
  v_after := public.dental_load(v_id,'p1');
  ASSERT v_after->'record' = v_before->'record', 'Clinical record preserved exactly';
  ASSERT v_after->'patient' = v_before->'patient', 'Documents and patient snapshot preserved';
  ASSERT v_after->'treatmentLedger' = v_before->'treatmentLedger', 'Budget, payments, debt and costs preserved';
  ASSERT (SELECT count(*) FROM public.dental_record_history WHERE professional_id = v_id) = v_history;
  v_rejected := false;
  BEGIN PERFORM public.dental_save(v_id,'p1',v_after->'record',1,true);
  EXCEPTION WHEN invalid_parameter_value THEN v_rejected := true; END;
  ASSERT v_rejected, 'Archived chart cannot be modified';
  v_rejected := false;
  BEGIN UPDATE public.user_workspaces SET patients_json = jsonb_build_array(jsonb_build_object(
    'id','duplicate','ownerUserId',v_id,'nombre','Ana','apellido','Test','dni','12.345.678')) WHERE user_id = v_id;
  EXCEPTION WHEN invalid_parameter_value THEN v_rejected := true; END;
  ASSERT v_rejected, 'Archived DNI cannot be duplicated under a new ID';

  UPDATE public.user_workspaces SET appointments_json = jsonb_build_array(jsonb_build_object(
    'id','past','patientDni','12345678','patientName','Ana Test','status','confirmed',
    'scheduledDate','2020-01-01','scheduledTime','10:00')) WHERE user_id = v_id;
  PERFORM public.dental_sync_provisional(v_id);
  ASSERT (SELECT jsonb_array_length(patients_json) FROM public.user_workspaces WHERE user_id = v_id) = 1,
    'Appointment sync does not recreate archived patient';
  ASSERT (SELECT appointments_json->0->>'patientId' FROM public.user_workspaces WHERE user_id = v_id) = 'p1';

  PERFORM public.dental_archive_patient(v_id,'p1','restore');
  ASSERT (SELECT state FROM public.dental_patient_archives WHERE professional_id = v_id AND patient_id = 'p1') = 'active';
  UPDATE public.user_workspaces SET patients_json = '[]' WHERE user_id = v_id;
  ASSERT (SELECT jsonb_array_length(patients_json) FROM public.user_workspaces WHERE user_id = v_id) = 1,
    'Stale workspace cannot delete a restored patient';
  PERFORM public.dental_save(v_id,'p1',v_after->'record',1,true);
  PERFORM public.dental_archive_patient(v_id,'p1','archive');
  PERFORM public.dental_archive_patient(v_id,'p1','confirm');
  ASSERT (SELECT state FROM public.dental_patient_archives WHERE professional_id = v_id AND patient_id = 'p1') = 'confirmed';
  ASSERT (SELECT confirmed_at IS NOT NULL FROM public.dental_patient_archives WHERE professional_id = v_id AND patient_id = 'p1');
  v_rejected := false;
  BEGIN PERFORM public.dental_archive_patient(v_id,'p1','restore');
  EXCEPTION WHEN invalid_parameter_value THEN v_rejected := true; END;
  ASSERT v_rejected, 'Confirmed archive cannot be restored';
  v_rejected := false;
  BEGIN PERFORM public.dental_save(v_id,'p1',v_after->'record',2,true);
  EXCEPTION WHEN invalid_parameter_value THEN v_rejected := true; END;
  ASSERT v_rejected, 'Confirmed archive remains read only';
  ASSERT public.dental_load(v_id,'p1')->'treatmentLedger' = v_before->'treatmentLedger';
  ASSERT public.dental_load(v_id,'p1')->'record' = v_before->'record';
  ASSERT NOT has_table_privilege('anon','public.dental_patient_archives','SELECT');
  ASSERT NOT has_function_privilege('authenticated','public.dental_archive_patient(text,text,text)','EXECUTE');
END;
$test$;
ROLLBACK;
