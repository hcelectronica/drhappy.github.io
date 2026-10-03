BEGIN;
DO $test$
DECLARE
  v_id text := gen_random_uuid()::text;
  v_record jsonb := '{
    "version":1,"patient":{"name":"Test, Ana","dni":"12345678","address":"",
      "phone":"","locality":"","coverage":""},
    "status":"provisional","marks":[],
    "treatments":[{"id":"t1","date":"2026-10-04","tooth":36,"surface":"central",
      "work":"Conducto","budgetCents":15000000,"internalCostCents":10000000,
      "status":"accepted","acceptedDate":"2026-10-04"}],
    "payments":[{"id":"p1","treatmentId":"t1","date":"2026-10-04","amountCents":4500000,"method":"Efectivo"}],
    "observations":"","coverageNotes":"","consentNotes":""}';
  v_result jsonb;
  v_entry jsonb;
  v_expected jsonb;
  v_case record;
BEGIN
  INSERT INTO public.professionals(id,username,full_name,specialty,license_number,email,active)
  VALUES (v_id,'dental-format-'||v_id,'Dental Format Test','Odontología','TEST',v_id||'@example.invalid',true);
  INSERT INTO public.user_workspaces(user_id,patients_json,appointments_json,treatment_ledger_json)
  VALUES (v_id,'[{"id":"patient","nombre":"Ana","apellido":"Test","dni":"12345678"}]','[]',
    '[{"id":"legacy","totalAmount":100,"paidAmount":20,"notes":"No modificar"}]');
  v_result := public.dental_save(v_id,'patient',v_record,0,false);
  v_entry := v_result->'treatmentLedger'->1;
  ASSERT v_entry->>'notes' = 'Pieza 36 · central · Costo interno: $ 100.000,00',
    'El caso de la captura debe mostrar $ 100.000,00 sin decimales adicionales';
  ASSERT (v_entry->>'totalAmount')::numeric = 150000;
  ASSERT (v_entry->>'paidAmount')::numeric = 45000;
  ASSERT (v_entry->>'totalAmount')::numeric - (v_entry->>'paidAmount')::numeric = 105000;
  ASSERT (v_entry->>'internalCost')::numeric = 100000;
  ASSERT v_result->'record' = v_record, 'El formato no modifica la ficha';
  ASSERT v_result->'treatmentLedger'->0 = '{"id":"legacy","totalAmount":100,"paidAmount":20,"notes":"No modificar"}'::jsonb;
  v_expected := v_entry - 'notes' - 'internalCost';

  FOR v_case IN SELECT * FROM (VALUES
    (0::bigint,'$ 0,00'),
    (1::bigint,'$ 0,01'),
    (123456::bigint,'$ 1.234,56'),
    (9007199254740991::bigint,'$ 90.071.992.547.409,91')
  ) cases(cents,label) LOOP
    UPDATE public.dental_records
    SET record = jsonb_set(record,'{treatments,0,internalCostCents}',to_jsonb(v_case.cents))
    WHERE professional_id = v_id AND patient_id = 'patient';
    v_entry := public.dental_project_ledger(v_id,v_result->'treatmentLedger')->1;
    ASSERT v_entry->>'notes' = 'Pieza 36 · central · Costo interno: ' || v_case.label;
    ASSERT (v_entry->>'internalCost')::numeric = v_case.cents::numeric / 100;
    ASSERT v_entry - 'notes' - 'internalCost' = v_expected, 'Presupuesto, pagos y metadatos permanecen iguales';
  END LOOP;
END;
$test$;
SELECT 'Formato argentino del costo interno y montos originales OK' AS test_result;
ROLLBACK;
