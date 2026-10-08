BEGIN;
DO $$
DECLARE actor text := 'correction-test-' || gen_random_uuid()::text;
  original jsonb; replacement jsonb; saved jsonb; patients jsonb; failed boolean;
BEGIN
  INSERT INTO professionals (id, username, full_name, specialty, license_number, email)
    VALUES (actor, actor, 'Profesional ficticio', 'Medicina general', 'TEST', actor || '@example.invalid');
  original := jsonb_build_object('id', 'fixture', 'date', clock_timestamp() - interval '1 hour',
    'motivoConsulta', 'Original', 'signatureSeal', jsonb_build_object('hashSha256', repeat('a', 64),
      'signedByUserId', actor, 'signedAt', clock_timestamp() - interval '1 hour'));
  patients := jsonb_build_array(jsonb_build_object('id', 'patient-fixture', 'consultations', jsonb_build_array(original)));
  INSERT INTO user_workspaces (user_id, patients_json) VALUES (actor, patients);
  replacement := original || jsonb_build_object('motivoConsulta', 'Corregido', 'correction',
    jsonb_build_object('reason', 'Error ficticio', 'previousHash', repeat('a', 64), 'originalDate', original->>'date'),
    'signatureSeal', jsonb_build_object('hashSha256', repeat('b', 64), 'signedByUserId', actor, 'signedAt', clock_timestamp()));
  saved := correct_clinical_consultation(actor, 'patient-fixture', 'fixture', repeat('a', 64), replacement);
  IF saved->'correctionHistory'->0->'previous' IS DISTINCT FROM original OR saved->>'date' IS DISTINCT FROM original->>'date' THEN
    RAISE EXCEPTION 'Original/date were not preserved';
  END IF;
  IF saved->'correctionHistory'->0->>'reason' <> 'Error ficticio' THEN RAISE EXCEPTION 'Reason missing'; END IF;
  failed := false;
  BEGIN PERFORM correct_clinical_consultation(actor, 'patient-fixture', 'fixture', repeat('a', 64), replacement);
  EXCEPTION WHEN unique_violation THEN failed := true; END;
  IF NOT failed THEN RAISE EXCEPTION 'Stale correction was accepted'; END IF;
  failed := false;
  BEGIN UPDATE user_workspaces SET patients_json = patients WHERE user_id = actor;
  EXCEPTION WHEN unique_violation THEN failed := true; END;
  IF NOT failed THEN RAISE EXCEPTION 'Stale workspace overwrote correction'; END IF;
  replacement := saved || jsonb_build_object('correction', jsonb_build_object('reason', 'Segunda corrección',
    'previousHash', repeat('b', 64), 'originalDate', original->>'date'), 'signatureSeal',
    jsonb_build_object('hashSha256', repeat('c', 64), 'signedByUserId', actor, 'signedAt', clock_timestamp()));
  saved := correct_clinical_consultation(actor, 'patient-fixture', 'fixture', repeat('b', 64), replacement);
  IF jsonb_array_length(saved->'correctionHistory') <> 2 OR saved->'correctionHistory'->1->'previous' ? 'correctionHistory' THEN
    RAISE EXCEPTION 'History was lost or nested';
  END IF;
  -- Simula vencimiento solo en el fixture, sin tocar datos reales.
  PERFORM set_config('drhappy.clinical_correction', 'allowed', true);
  UPDATE user_workspaces SET patients_json = jsonb_set(patients, '{0,consultations,0,date}', to_jsonb((clock_timestamp() - interval '25 hours')::text)) WHERE user_id = actor;
  PERFORM set_config('drhappy.clinical_correction', '', true);
  failed := false;
  BEGIN PERFORM correct_clinical_consultation(actor, 'patient-fixture', 'fixture', repeat('a', 64), replacement);
  EXCEPTION WHEN invalid_parameter_value THEN failed := true; END;
  IF NOT failed THEN RAISE EXCEPTION 'Expired correction was accepted'; END IF;
  IF has_function_privilege('authenticated', 'public.correct_clinical_consultation(text,text,text,text,jsonb)', 'execute')
    OR has_function_privilege('anon', 'public.correct_clinical_consultation(text,text,text,text,jsonb)', 'execute') THEN
    RAISE EXCEPTION 'RPC is callable without trusted server';
  END IF;
END $$;
ROLLBACK;
