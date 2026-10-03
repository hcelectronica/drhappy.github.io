-- Execute after migrations using a disposable database / SQL editor. No production data is read.
BEGIN;
DO $test$
DECLARE
  v_id text := gen_random_uuid()::text;
  v_other text := gen_random_uuid()::text;
  v_doctor text := gen_random_uuid()::text;
  v_record jsonb := '{
    "version":1,"patient":{"name":"Ana Test","dni":"12345678","address":"Calle Test",
      "phone":"123","locality":"Test","coverage":"Cobertura","email":"test@example.invalid",
      "birthDate":"2000-01-01","memberNumber":"123"},
    "status":"provisional","marks":[{"id":"mark","tooth":11,"surface":"mesial",
      "condition":"caries","status":"needed","note":"","createdAt":"2026-10-04T12:00:00Z"}],
    "treatments":[{"id":"t1","date":"2026-10-04","tooth":11,"surface":"mesial",
      "work":"Restauración","budgetCents":10000,"internalCostCents":2500,
      "status":"accepted","acceptedDate":"2026-10-04"}],
    "payments":[{"id":"pay1","treatmentId":"t1","date":"2026-10-04","amountCents":3000,"method":"Efectivo"}],
    "observations":"","coverageNotes":"","consentNotes":""}';
  v_result jsonb;
  v_candidate jsonb;
  v_before jsonb;
  v_ledger jsonb;
  v_projection jsonb;
  v_patient jsonb;
  v_rejected boolean;
BEGIN
  INSERT INTO public.professionals(id,username,full_name,specialty,license_number,email,active)
  VALUES (v_id,'dental-test-'||v_id,'Dental Test','ODONTÓLOGA','TEST',v_id||'@example.invalid',true),
    (v_other,'dental-test-'||v_other,'Otro Test','Odontología','TEST',v_other||'@example.invalid',true),
    (v_doctor,'dental-test-'||v_doctor,'Doctor Test','Clínica','TEST',v_doctor||'@example.invalid',true);
  INSERT INTO public.user_workspaces(user_id,patients_json,appointments_json,treatment_ledger_json)
  VALUES (v_id,
    '[{"id":"p1","nombre":"Ana","apellido":"Test","dni":"12345678","consultations":[{"id":"clinical"}],
      "documents":[{"id":"doc"}],"plan":"Plan preservado"},{"id":"p2","nombre":"Otro","apellido":"Test","dni":"87654321"}]',
    '[{"id":"a1","patientId":"p1","status":"confirmed"},{"id":"a2","patientId":"p2","status":"confirmed"},
      {"id":"a3","patientDni":"12.345.678","status":"confirmed"},
      {"id":"a4","patientId":"p2","patientDni":"12345678","status":"confirmed"}]',
    '[{"id":"legacy","patientId":"p1","totalAmount":50,"paidAmount":5}]'),
    (v_other,'[{"id":"foreign","nombre":"Otra","apellido":"Test"}]','[]','[]'),
    (v_doctor,'[{"id":"p1"}]','[]','[]');
  v_result := public.dental_load(v_id,'p1');
  ASSERT v_result->'record' = 'null'::jsonb AND (v_result->>'revision')::integer = 0;
  ASSERT v_result->'history' = '[]'::jsonb;
  v_rejected := false;
  BEGIN PERFORM public.dental_load(v_other,'p1');
  EXCEPTION WHEN no_data_found THEN v_rejected := true; END;
  ASSERT v_rejected, 'No permite pacientes de otro profesional';
  v_rejected := false;
  BEGIN PERFORM public.dental_load(v_doctor,'p1');
  EXCEPTION WHEN insufficient_privilege THEN v_rejected := true; END;
  ASSERT v_rejected, 'No odontólogos rechazados';
  v_result := public.dental_save(v_id,'p1',v_record,0,false);
  ASSERT (v_result->>'revision')::integer = 1 AND v_result->'record' = v_record;
  ASSERT (public.dental_load(v_id,'p1')->>'revision')::integer = 1;
  ASSERT v_result->'appointments'->0->>'status' = 'confirmed', 'Provisional no atiende';
  v_patient := v_result->'patient';
  ASSERT v_patient->>'dentalStatus' = 'provisional' AND v_patient->>'obraSocial' = 'Cobertura';
  ASSERT v_patient->>'email' = 'test@example.invalid' AND v_patient->>'numeroAfiliado' = '123';
  ASSERT v_patient->'consultations' = '[{"id":"clinical"}]' AND v_patient->'documents' = '[{"id":"doc"}]';
  ASSERT v_patient->>'plan' = 'Plan preservado', 'Conserva propiedades clínicas y administrativas';
  SELECT value INTO v_projection FROM jsonb_array_elements(v_result->'treatmentLedger')
    WHERE value->>'id' = 'dental:p1:t1';
  ASSERT (v_projection->>'totalAmount')::numeric = 100 AND (v_projection->>'paidAmount')::numeric = 30;
  ASSERT (v_projection->>'internalCost')::numeric = 25, 'Costo interno separado del presupuesto';
  ASSERT jsonb_array_length(v_result->'treatmentLedger') = 2, 'Conserva balance no dental';
  v_rejected := false;
  BEGIN PERFORM public.dental_save(v_id,'p1',v_record,0,false);
  EXCEPTION WHEN SQLSTATE 'PT409' THEN v_rejected := true; END;
  ASSERT v_rejected, 'Segundo escritor con misma revisión pierde sin duplicar';
  ASSERT (SELECT count(*) FROM public.dental_record_history WHERE professional_id = v_id AND patient_id = 'p1') = 1;
  v_before := v_result;

  v_candidate := jsonb_set(v_record,'{payments}','[]');
  v_rejected := false;
  BEGIN PERFORM public.dental_save(v_id,'p1',v_candidate,1,false);
  EXCEPTION WHEN invalid_parameter_value THEN v_rejected := true; END;
  ASSERT v_rejected, 'No elimina pagos guardados';
  v_candidate := jsonb_set(v_record,'{payments,0,amountCents}','4000');
  v_rejected := false;
  BEGIN PERFORM public.dental_save(v_id,'p1',v_candidate,1,false);
  EXCEPTION WHEN invalid_parameter_value THEN v_rejected := true; END;
  ASSERT v_rejected, 'No modifica pagos guardados';
  v_candidate := jsonb_set(v_record,'{patient,dni}','"99999999"');
  v_rejected := false;
  BEGIN PERFORM public.dental_save(v_id,'p1',v_candidate,1,false);
  EXCEPTION WHEN invalid_parameter_value THEN v_rejected := true; END;
  ASSERT v_rejected, 'Identidad DNI guardada es inmutable';
  v_candidate := jsonb_set(v_record,'{treatments,0,id}','"renamed"');
  v_rejected := false;
  BEGIN PERFORM public.dental_save(v_id,'p1',v_candidate,1,false);
  EXCEPTION WHEN invalid_parameter_value THEN v_rejected := true; END;
  ASSERT v_rejected, 'No renombra trabajo pagado';
  v_candidate := jsonb_set(v_record,'{treatments,0,budgetCents}','15000');
  v_rejected := false;
  BEGIN PERFORM public.dental_save(v_id,'p1',v_candidate,1,false);
  EXCEPTION WHEN invalid_parameter_value THEN v_rejected := true; END;
  ASSERT v_rejected, 'No cambia importe aceptado';
  v_candidate := jsonb_set(v_record,'{treatments,0,status}','"cancelled"');
  v_rejected := false;
  BEGIN PERFORM public.dental_save(v_id,'p1',v_candidate,1,false);
  EXCEPTION WHEN invalid_parameter_value THEN v_rejected := true; END;
  ASSERT v_rejected, 'No cancela trabajos con pagos';
  v_candidate := jsonb_set(v_record,'{payments}',v_record->'payments' || v_record->'payments');
  v_rejected := false;
  BEGIN PERFORM public.dental_save(v_id,'p1',v_candidate,1,false);
  EXCEPTION WHEN invalid_parameter_value THEN v_rejected := true; END;
  ASSERT v_rejected, 'No duplica pagos';
  v_candidate := jsonb_set(v_record,'{payments}',v_record->'payments' ||
    '[{"id":"pay2","treatmentId":"t1","date":"2026-10-04","amountCents":7001,"method":"Efectivo"}]');
  v_rejected := false;
  BEGIN PERFORM public.dental_save(v_id,'p1',v_candidate,1,false);
  EXCEPTION WHEN invalid_parameter_value THEN v_rejected := true; END;
  ASSERT v_rejected, 'No sobrepaga';
  v_candidate := jsonb_set(v_record,'{treatments,0,budgetCents}','10000.5');
  v_rejected := false;
  BEGIN PERFORM public.dental_save(v_id,'p1',v_candidate,1,false);
  EXCEPTION WHEN invalid_parameter_value THEN v_rejected := true; END;
  ASSERT v_rejected, 'No acepta fracciones de centavo';
  v_candidate := jsonb_set(v_record,'{treatments,0,date}','"2026-02-30"');
  v_rejected := false;
  BEGIN PERFORM public.dental_save(v_id,'p1',v_candidate,1,false);
  EXCEPTION WHEN invalid_parameter_value THEN v_rejected := true; END;
  ASSERT v_rejected, 'No normaliza fechas inexistentes';
  v_candidate := jsonb_set(v_record,'{marks,0,tooth}','19');
  v_rejected := false;
  BEGIN PERFORM public.dental_save(v_id,'p1',v_candidate,1,false);
  EXCEPTION WHEN invalid_parameter_value THEN v_rejected := true; END;
  ASSERT v_rejected, 'FDI inválido rechazado';
  v_candidate := jsonb_set(v_record,'{marks,0,surface}','"invalid"');
  v_rejected := false;
  BEGIN PERFORM public.dental_save(v_id,'p1',v_candidate,1,false);
  EXCEPTION WHEN invalid_parameter_value THEN v_rejected := true; END;
  ASSERT v_rejected, 'Superficie inválida rechazada';
  v_candidate := jsonb_set(v_record,'{marks,0,condition}','"invalid"');
  v_rejected := false;
  BEGIN PERFORM public.dental_save(v_id,'p1',v_candidate,1,false);
  EXCEPTION WHEN invalid_parameter_value THEN v_rejected := true; END;
  ASSERT v_rejected, 'Condición inválida rechazada';
  v_candidate := jsonb_set(v_record,'{payments,0,treatmentId}','"missing"');
  v_rejected := false;
  BEGIN PERFORM public.dental_save(v_id,'p1',v_candidate,1,false);
  EXCEPTION WHEN invalid_parameter_value THEN v_rejected := true; END;
  ASSERT v_rejected, 'Pago sin referencia válida rechazado';
  v_candidate := jsonb_set(v_record,'{payments,0,date}','"2026-10-03"');
  v_rejected := false;
  BEGIN PERFORM public.dental_save(v_id,'p1',v_candidate,1,false);
  EXCEPTION WHEN invalid_parameter_value THEN v_rejected := true; END;
  ASSERT v_rejected, 'Pago anterior a aceptación rechazado';
  ASSERT public.dental_load(v_id,'p1')->'record' = v_before->'record', 'Rechazos son atómicos';
  v_candidate := jsonb_set(v_record,'{status}','"confirmed"');
  v_rejected := false;
  BEGIN PERFORM public.dental_save(v_id,'p1',v_candidate,1,true,'a2');
  EXCEPTION WHEN invalid_parameter_value THEN v_rejected := true; END;
  ASSERT v_rejected, 'No atiende turnos ajenos';
  v_rejected := false;
  BEGIN PERFORM public.dental_save(v_id,'p1',v_candidate,1,true,'a4');
  EXCEPTION WHEN invalid_parameter_value THEN v_rejected := true; END;
  ASSERT v_rejected, 'DNI no autoriza un turno ligado a otro paciente';
  v_rejected := false;
  BEGIN PERFORM public.dental_save(v_id,'p1',v_record,1,false,'a1');
  EXCEPTION WHEN invalid_parameter_value THEN v_rejected := true; END;
  ASSERT v_rejected, 'Provisional no admite atención';
  v_candidate := jsonb_set(v_candidate,'{payments}',v_record->'payments' ||
    '[{"id":"pay2","treatmentId":"t1","date":"2026-10-05","amountCents":2000,"method":"Transferencia"}]');
  v_result := public.dental_save(v_id,'p1',v_candidate,1,true,'a1');
  ASSERT v_result->'appointments'->0->>'status' = 'attended';
  ASSERT v_result->'appointments'->1->>'status' = 'confirmed';
  ASSERT v_result->'patient'->>'dentalStatus' = 'confirmed';
  ASSERT (SELECT count(*) FROM public.dental_record_history WHERE professional_id = v_id AND patient_id = 'p1') = 2;
  ASSERT jsonb_array_length(v_result->'history') = 2 AND v_result->'history'->0->>'revision' = '2';
  ASSERT (v_result->'history'->0->>'confirmed')::boolean AND NOT v_result->'history'->0 ? 'record';
  ASSERT (SELECT record FROM public.dental_record_history WHERE professional_id = v_id AND patient_id = 'p1' AND revision = 1) = v_record;
  v_rejected := false;
  BEGIN UPDATE public.dental_record_history SET record = '{}' WHERE professional_id = v_id;
  EXCEPTION WHEN invalid_parameter_value THEN v_rejected := true; END;
  ASSERT v_rejected, 'Historial no se reescribe';
  v_rejected := false;
  BEGIN DELETE FROM public.dental_record_history WHERE professional_id = v_id;
  EXCEPTION WHEN invalid_parameter_value THEN v_rejected := true; END;
  ASSERT v_rejected, 'Historial no se elimina';
  v_result := public.dental_save(v_id,'p1',v_candidate,2,true,'a3');
  ASSERT v_result->'appointments'->2->>'status' = 'attended', 'Permite DNI para turno no ligado';
  v_candidate := jsonb_set(v_candidate,'{treatments,0,status}','"completed"');
  v_candidate := jsonb_set(v_candidate,'{treatments,0,performedDate}','"2026-10-05"');
  v_result := public.dental_save(v_id,'p1',v_candidate,3,true);
  SELECT value INTO v_projection FROM jsonb_array_elements(v_result->'treatmentLedger')
    WHERE value->>'id' = 'dental:p1:t1';
  ASSERT (v_projection->>'paidAmount')::numeric = 50 AND v_projection->>'date' = '2026-10-05';
  v_candidate := jsonb_set(v_record,'{patient,name}','"Otro Test"');
  v_candidate := jsonb_set(v_candidate,'{patient,dni}','"87654321"');
  v_candidate := jsonb_set(v_candidate,'{payments}','[]');
  PERFORM public.dental_save(v_id,'p2',v_candidate,0,false);
  v_ledger := public.dental_merge_ledger(v_id,'[
    {"id":"manual","patientId":"p1","totalAmount":75},
    {"id":"dental:p1:t1","paidAmount":0},{"id":"fake","dentalTreatmentId":"evil"}]');
  ASSERT jsonb_array_length(v_ledger) = 3, 'Solo manual + dos proyecciones autoritativas';
  SELECT value INTO v_projection FROM jsonb_array_elements(v_ledger) WHERE value->>'id' = 'dental:p1:t1';
  ASSERT (v_projection->>'paidAmount')::numeric = 50, 'Balance genérico no modifica pagos';
  ASSERT EXISTS (SELECT 1 FROM jsonb_array_elements(v_ledger) WHERE value->>'id' = 'dental:p2:t1');
  UPDATE public.user_workspaces SET treatment_ledger_json = '[]',
    patients_json = '[{"id":"p1","dentalStatus":"provisional"},{"id":"p2"}]' WHERE user_id = v_id;
  SELECT treatment_ledger_json,patients_json->0 INTO v_ledger,v_patient FROM public.user_workspaces WHERE user_id = v_id;
  ASSERT jsonb_array_length(v_ledger) = 2, 'Save workspace no elimina proyecciones';
  ASSERT v_patient->>'dentalStatus' = 'confirmed', 'Save workspace conserva estado dedicado';
  ASSERT v_patient->>'dni' = '12345678', 'Save workspace conserva identidad dental canónica';
  ASSERT v_patient->>'nombre' = 'Ana' AND v_patient->>'apellido' = 'Test';
  ASSERT v_patient->>'direccion' = 'Calle Test' AND v_patient->>'telefono' = '123';
  ASSERT v_patient->>'obraSocial' = 'Cobertura' AND v_patient->>'email' = 'test@example.invalid';
  ASSERT v_patient->>'birthDate' = '2000-01-01' AND v_patient->>'numeroAfiliado' = '123';
  ASSERT (public.dental_load(v_id,'p1')->>'revision')::integer = 4;
  v_candidate := jsonb_set(v_candidate,'{treatments,0,status}','"cancelled"');
  v_result := public.dental_save(v_id,'p2',v_candidate,1,false);
  ASSERT jsonb_array_length(v_result->'treatmentLedger') = 1, 'Cancela presupuesto sin pagos conservando otro paciente';
  ASSERT (SELECT count(*) FROM public.dental_record_history WHERE professional_id = v_id AND patient_id = 'p2') = 2;
  ASSERT NOT has_function_privilege('anon','public.dental_load(text,text)','EXECUTE'), 'Anon must not execute dental_load';
  ASSERT NOT has_function_privilege('authenticated','public.dental_save(text,text,jsonb,integer,boolean,text)','EXECUTE'), 'Authenticated must not execute dental_save';
  ASSERT NOT has_function_privilege('authenticated','public.dental_merge_ledger(text,jsonb)','EXECUTE'), 'Authenticated must not execute dental_merge_ledger';
  ASSERT NOT has_function_privilege('authenticated','public.dental_sync_provisional(text)','EXECUTE'), 'Authenticated must not execute dental_sync_provisional';
  ASSERT NOT has_table_privilege('authenticated','public.dental_records','SELECT'), 'Authenticated must not read dental_records';
  ASSERT NOT has_table_privilege('service_role','public.dental_record_history','UPDATE'), 'Service role history UPDATE must be revoked despite Supabase default privileges';
  ASSERT NOT has_table_privilege('service_role','public.dental_record_history','DELETE'), 'Service role history DELETE must be revoked despite Supabase default privileges';
  ASSERT NOT has_table_privilege('service_role','public.dental_record_history','TRUNCATE'), 'Service role history TRUNCATE must be revoked despite Supabase default privileges';
  v_rejected := false;
  BEGIN UPDATE public.user_workspaces SET patients_json = '[{"id":"p2"}]' WHERE user_id = v_id;
  EXCEPTION WHEN invalid_parameter_value THEN v_rejected := true; END;
  ASSERT v_rejected, 'No elimina paciente confirmado/pagado';
END;
$test$;
DO $sync_test$
DECLARE
  v_id text := gen_random_uuid()::text;
  v_result jsonb;
  v_again jsonb;
  v_patient jsonb;
  v_appointments jsonb;
  v_record jsonb;
BEGIN
  INSERT INTO public.professionals(id,username,full_name,specialty,license_number,email,active)
    VALUES (v_id,'sync-test-'||v_id,'Sync Test','Odontología','TEST',v_id||'@example.invalid',true);
  INSERT INTO public.user_workspaces(user_id,patients_json,appointments_json) VALUES (v_id,
    '[{"id":"existing","nombre":"Nombre","apellido":"Igual","dni":"11111111","email":"same@example.invalid","documents":[{"id":"keep"}]}]',
    '[{"id":"same-dni","patientName":"Diferente","patientDni":"11.111.111","status":"pending"},
      {"id":"new-dni","patientId":"explicit-new","patientName":"Pérez, María Ana","patientDni":"22222222","patientEmail":"same@example.invalid","status":"pending"},
      {"id":"reuse-new-dni","patientName":"Otro nombre","patientDni":"22.222.222","status":"confirmed"},
      {"id":"no-dni-1","patientName":"Nombre Igual","patientEmail":"same@example.invalid","status":"pending"},
      {"id":"no-dni-2","patientName":"Nombre Igual","patientEmail":"same@example.invalid","status":"pending"},
      {"id":"explicit-existing","patientId":"existing","patientName":"Sin documento","status":"confirmed"},
      {"id":"cancelled","patientName":"Cancelado","patientDni":"33333333","status":"cancelled"},
      {"id":"attended","patientName":"Atendido","patientDni":"44444444","status":"attended"},
      {"id":"identity-conflict","patientId":"existing","patientDni":"99999999","status":"pending"}]');
  v_result := public.dental_sync_provisional(v_id);
  ASSERT jsonb_array_length(v_result->'patients_json') = 4, 'Solo DNI o identidad explícita permiten agrupar';
  v_appointments := v_result->'appointments_json';
  ASSERT v_appointments->0->>'patientId' = 'existing';
  ASSERT v_appointments->1->>'patientId' = 'explicit-new' AND v_appointments->2->>'patientId' = 'explicit-new';
  ASSERT v_appointments->3->>'patientId' <> v_appointments->4->>'patientId', 'Sin DNI y sin identidad explícita son distintos';
  ASSERT v_appointments->5->>'patientId' = 'existing';
  ASSERT NOT v_appointments->6 ? 'patientId', 'Cancelados no crean pacientes';
  ASSERT v_appointments->8->>'patientId' = 'existing', 'Conflicto explícito no se religa';
  SELECT value INTO v_patient FROM jsonb_array_elements(v_result->'patients_json') WHERE value->>'id' = 'explicit-new';
  ASSERT v_patient->>'nombre' = 'María Ana' AND v_patient->>'apellido' = 'Pérez';
  ASSERT v_patient->>'ownerUserId' = v_id AND v_patient->>'dentalStatus' = 'provisional';
  ASSERT v_patient->'documents' = '[]'::jsonb AND v_patient->'consultations' = '[]'::jsonb;
  ASSERT v_patient->>'email' = 'same@example.invalid' AND v_patient->>'birthDate' = '';
  ASSERT v_patient ? 'patologiasConocidas' AND v_patient ? 'cirugiasPrevias';
  ASSERT NOT v_appointments->7 ? 'patientId', 'Turno atendido no crea pacientes perdidos';
  ASSERT v_result->'patients_json'->0->'documents' = '[{"id":"keep"}]'::jsonb;
  v_again := public.dental_sync_provisional(v_id);
  ASSERT v_again = v_result, 'La sincronización repetida es idempotente';
  v_record := '{"version":1,"patient":{"name":"Pérez, María Ana","nombre":"María Ana","apellido":"Pérez",
    "dni":"22.222.222","address":"","phone":"","locality":"","coverage":""},"status":"provisional",
    "marks":[],"treatments":[],"payments":[],"observations":"","coverageNotes":"","consentNotes":""}';
  v_result := public.dental_save(v_id,'explicit-new',v_record,0,false);
  ASSERT v_result->'record'->'patient'->>'dni' = '22222222', 'DNI es canónico desde workspace';
  ASSERT v_result->'patient'->>'nombre' = 'María Ana' AND v_result->'patient'->>'apellido' = 'Pérez';
  v_record := v_result->'record';
  v_record := jsonb_set(v_record,'{patient,name}','"Gómez, Juana María"');
  v_record := (v_record #- '{patient,nombre}') #- '{patient,apellido}';
  v_result := public.dental_save(v_id,'explicit-new',v_record,1,false);
  ASSERT v_result->'patient'->>'nombre' = 'Juana María' AND v_result->'patient'->>'apellido' = 'Gómez';
  UPDATE public.user_workspaces SET patients_json = (
    SELECT jsonb_agg(value) FROM jsonb_array_elements(patients_json) WHERE value->>'id' <> 'explicit-new'
  ) WHERE user_id = v_id;
  v_result := public.dental_sync_provisional(v_id);
  ASSERT NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_result->'patients_json') WHERE value->>'id' = 'explicit-new'),
    'No resucita paciente provisional eliminado mediante turnos pendientes';
  BEGIN
    PERFORM public.dental_load(v_id,'explicit-new');
    RAISE EXCEPTION 'No debe cargar ficha de paciente eliminado';
  EXCEPTION WHEN no_data_found THEN NULL; END;
END;
$sync_test$;
DO $identity_test$
DECLARE
  v_id text := gen_random_uuid()::text;
  v_record jsonb := '{"version":1,"patient":{"name":"Test, Ana","dni":"","address":"","phone":"","locality":"","coverage":""},
    "status":"provisional","marks":[],"treatments":[],"payments":[],"observations":"","coverageNotes":"","consentNotes":""}';
  v_candidate jsonb;
  v_result jsonb;
  v_rejected boolean;
BEGIN
  INSERT INTO public.professionals(id,username,full_name,specialty,license_number,email,active)
    VALUES (v_id,'identity-'||v_id,'Identity Test','Odontología','TEST',v_id||'@example.invalid',true);
  INSERT INTO public.user_workspaces(user_id,patients_json)
    VALUES (v_id,'[{"id":"blank","nombre":"Ana","apellido":"Test","dni":""},{"id":"other","dni":"11111111"}]');
  v_result := public.dental_save(v_id,'blank',v_record,0,false);
  ASSERT v_result->'record'->'patient'->>'dni' = '', 'Permite guardar borrador sin DNI';
  v_candidate := jsonb_set(v_record,'{status}','"confirmed"');
  v_rejected := false;
  BEGIN PERFORM public.dental_save(v_id,'blank',v_candidate,1,true);
  EXCEPTION WHEN invalid_parameter_value THEN v_rejected := true; END;
  ASSERT v_rejected, 'Confirmación requiere DNI';
  v_candidate := jsonb_set(v_record,'{patient,dni}','"11.111.111"');
  v_rejected := false;
  BEGIN PERFORM public.dental_save(v_id,'blank',v_candidate,1,false);
  EXCEPTION WHEN invalid_parameter_value THEN v_rejected := true; END;
  ASSERT v_rejected, 'No llena DNI de otro paciente ni fusiona';
  v_candidate := jsonb_set(v_record,'{patient,dni}','"abc12345678"');
  v_rejected := false;
  BEGIN PERFORM public.dental_save(v_id,'blank',v_candidate,1,false);
  EXCEPTION WHEN invalid_parameter_value THEN v_rejected := true; END;
  ASSERT v_rejected, 'Rechaza DNI alfanumérico';
  v_candidate := jsonb_set(v_record,'{patient,dni}','"12.345.678"');
  v_result := public.dental_save(v_id,'blank',v_candidate,1,false);
  ASSERT v_result->'record'->'patient'->>'dni' = '12345678' AND v_result->'patient'->>'dni' = '12345678';
  v_candidate := jsonb_set(v_result->'record','{patient,dni}','"87654321"');
  v_rejected := false;
  BEGIN PERFORM public.dental_save(v_id,'blank',v_candidate,2,false);
  EXCEPTION WHEN invalid_parameter_value THEN v_rejected := true; END;
  ASSERT v_rejected, 'DNI completado ya es inmutable';
  v_candidate := jsonb_set(v_result->'record','{status}','"confirmed"');
  v_candidate := jsonb_set(v_candidate,'{patient,name}','"Ana"');
  v_rejected := false;
  BEGIN PERFORM public.dental_save(v_id,'blank',v_candidate,2,true);
  EXCEPTION WHEN invalid_parameter_value THEN v_rejected := true; END;
  ASSERT v_rejected, 'Confirmación requiere apellido';
  v_candidate := jsonb_set(v_result->'record','{status}','"confirmed"');
  v_result := public.dental_save(v_id,'blank',v_candidate,2,true);
  ASSERT (v_result->>'revision')::integer = 3 AND v_result->'patient'->>'dentalStatus' = 'confirmed';
END;
$identity_test$;
SELECT 'Dental: aislamiento, validación, revisiones, pagos, proyección, historial y turnos OK' AS test_result;
ROLLBACK;
