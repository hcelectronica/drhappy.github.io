CREATE OR REPLACE FUNCTION public.protect_clinical_consultations()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
DECLARE old_patient jsonb; old_entry jsonb; new_patient jsonb; new_entry jsonb;
BEGIN
  IF current_setting('drhappy.clinical_correction', true) = 'allowed' THEN RETURN NEW; END IF;
  FOR old_patient IN SELECT value FROM jsonb_array_elements(coalesce(OLD.patients_json, '[]'::jsonb)) LOOP
    SELECT value INTO new_patient FROM jsonb_array_elements(coalesce(NEW.patients_json, '[]'::jsonb))
      WHERE value->>'id' = old_patient->>'id';
    IF new_patient IS NULL THEN CONTINUE; END IF;
    FOR old_entry IN SELECT value FROM jsonb_array_elements(coalesce(old_patient->'consultations', '[]'::jsonb))
      WHERE value->'signatureSeal'->>'hashSha256' IS NOT NULL
        AND value->>'certificateId' IS NULL AND value->>'id' !~ '^(video-|virtual-)' LOOP
      SELECT value INTO new_entry FROM jsonb_array_elements(coalesce(new_patient->'consultations', '[]'::jsonb))
        WHERE value->>'id' = old_entry->>'id';
      IF new_entry IS NULL OR (new_entry - 'diagnostico') IS DISTINCT FROM (old_entry - 'diagnostico')
        OR coalesce(new_entry->>'diagnostico', '') IS DISTINCT FROM coalesce(old_entry->>'diagnostico', '') THEN
        RAISE EXCEPTION 'Una evolución firmada cambió en otra pestaña o fue modificada sin registrar corrección. Recargá la ficha antes de guardar.'
          USING ERRCODE = '40001';
      END IF;
    END LOOP;
  END LOOP;
  RETURN NEW;
END $$;

CREATE TRIGGER protect_clinical_consultations
BEFORE UPDATE OF patients_json ON public.user_workspaces
FOR EACH ROW EXECUTE FUNCTION public.protect_clinical_consultations();

CREATE OR REPLACE FUNCTION public.correct_clinical_consultation(
  p_professional_id text, p_patient_id text, p_consultation_id text,
  p_expected_hash text, p_replacement jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE patients jsonb; patient jsonb; original jsonb; replacement jsonb; snapshot jsonb;
  patient_index integer; entry_index integer; started_at timestamptz; signed_at timestamptz;
  history jsonb; corrected_at timestamptz := clock_timestamp();
BEGIN
  SELECT patients_json INTO patients FROM user_workspaces WHERE user_id = p_professional_id FOR UPDATE;
  SELECT value, ordinality::integer - 1 INTO patient, patient_index FROM jsonb_array_elements(coalesce(patients, '[]'::jsonb)) WITH ORDINALITY
    WHERE value->>'id' = p_patient_id;
  SELECT value, ordinality::integer - 1 INTO original, entry_index FROM jsonb_array_elements(coalesce(patient->'consultations', '[]'::jsonb)) WITH ORDINALITY
    WHERE value->>'id' = p_consultation_id;
  IF original IS NULL THEN RAISE EXCEPTION 'No se encontró la evolución guardada.' USING ERRCODE = 'P0002'; END IF;
  IF original->'signatureSeal'->>'signedByUserId' IS DISTINCT FROM p_professional_id::text
    OR original->>'certificateId' IS NOT NULL OR p_consultation_id ~ '^(video-|virtual-)' THEN
    RAISE EXCEPTION 'Solo el autor puede corregir una evolución clínica firmada.' USING ERRCODE = '42501';
  END IF;
  IF original->'signatureSeal'->>'hashSha256' IS DISTINCT FROM p_expected_hash THEN
    RAISE EXCEPTION 'La evolución ya fue corregida. Recargá la ficha antes de reintentar.' USING ERRCODE = '40001';
  END IF;
  BEGIN
    started_at := (original->>'date')::timestamptz;
    signed_at := coalesce(original->'correctionHistory'->0->'previous'->'signatureSeal'->>'signedAt', original->'signatureSeal'->>'signedAt')::timestamptz;
  EXCEPTION WHEN invalid_datetime_format OR datetime_field_overflow THEN
    RAISE EXCEPTION 'Fecha original inválida.' USING ERRCODE = '22023';
  END;
  started_at := least(started_at, signed_at);
  IF started_at IS NULL OR signed_at IS NULL OR started_at > corrected_at OR corrected_at >= started_at + interval '24 hours' THEN
    RAISE EXCEPTION 'Venció el plazo de 24 horas desde la evolución original. No puede modificarse.' USING ERRCODE = '22023';
  END IF;
  IF p_replacement->>'id' IS DISTINCT FROM p_consultation_id OR p_replacement->>'date' IS DISTINCT FROM original->>'date'
    OR p_replacement->'correction'->>'previousHash' IS DISTINCT FROM p_expected_hash
    OR p_replacement->'correction'->>'originalDate' IS DISTINCT FROM original->>'date'
    OR length(trim(coalesce(p_replacement->'correction'->>'reason', ''))) NOT BETWEEN 1 AND 1000
    OR p_replacement->'signatureSeal'->>'signedByUserId' IS DISTINCT FROM p_professional_id::text THEN
    RAISE EXCEPTION 'Corrección inválida.' USING ERRCODE = '22023';
  END IF;
  history := coalesce(original->'correctionHistory', '[]'::jsonb);
  snapshot := original - 'correctionHistory';
  replacement := (p_replacement - 'correctionHistory') || jsonb_build_object('correctionHistory',
    history || jsonb_build_array(jsonb_build_object('previous', snapshot, 'correctedAt', corrected_at,
      'correctedByUserId', p_professional_id, 'reason', trim(p_replacement->'correction'->>'reason'),
      'newHash', p_replacement->'signatureSeal'->>'hashSha256')));
  patients := jsonb_set(patients, ARRAY[patient_index::text, 'consultations', entry_index::text], replacement);
  PERFORM set_config('drhappy.clinical_correction', 'allowed', true);
  UPDATE user_workspaces SET patients_json = patients WHERE user_id = p_professional_id;
  PERFORM set_config('drhappy.clinical_correction', '', true);
  RETURN replacement;
END $$;

REVOKE ALL ON FUNCTION public.correct_clinical_consultation(text, text, text, text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.correct_clinical_consultation(text, text, text, text, jsonb) TO service_role;
