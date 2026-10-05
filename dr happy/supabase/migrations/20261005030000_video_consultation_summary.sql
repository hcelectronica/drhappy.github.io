BEGIN;

ALTER TABLE public.video_consultations ADD COLUMN summary_saved_at timestamptz;

-- Agrega en una sola operación la evolución revisada de una videoconsulta a la ficha del paciente.
CREATE FUNCTION public.append_video_consultation_entry(p_professional_id text, p_consultation_id uuid, p_entry jsonb)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_consultation public.video_consultations;
  v_patients jsonb;
  v_index integer;
BEGIN
  IF jsonb_typeof(p_entry) <> 'object' OR p_entry->>'id' <> 'video-' || p_consultation_id::text THEN
    RAISE EXCEPTION 'Invalid video consultation entry';
  END IF;
  SELECT * INTO v_consultation FROM public.video_consultations
    WHERE id = p_consultation_id AND professional_id = p_professional_id FOR UPDATE;
  IF NOT FOUND OR v_consultation.started_at IS NULL THEN RETURN 'missing'; END IF;
  IF v_consultation.summary_saved_at IS NOT NULL THEN RETURN 'duplicate'; END IF;
  SELECT patients_json INTO v_patients FROM public.user_workspaces WHERE user_id = p_professional_id FOR UPDATE;
  IF jsonb_typeof(v_patients) <> 'array' THEN RETURN 'missing'; END IF;
  SELECT ordinality - 1 INTO v_index FROM jsonb_array_elements(v_patients) WITH ORDINALITY
    WHERE value->>'id' = v_consultation.patient_id AND value->>'ownerUserId' = p_professional_id LIMIT 1;
  IF v_index IS NULL OR EXISTS (SELECT 1 FROM public.dental_patient_archives
    WHERE professional_id = p_professional_id AND patient_id = v_consultation.patient_id AND state <> 'active') THEN
    RETURN 'missing';
  END IF;
  UPDATE public.user_workspaces SET patients_json = jsonb_set(
    jsonb_set(v_patients, ARRAY[v_index::text, 'consultations'],
      jsonb_build_array(p_entry) || CASE WHEN jsonb_typeof(v_patients->v_index->'consultations') = 'array'
        THEN v_patients->v_index->'consultations' ELSE '[]'::jsonb END),
    ARRAY[v_index::text, 'updatedAt'], to_jsonb(p_entry->>'date'))
  WHERE user_id = p_professional_id;
  UPDATE public.video_consultations SET summary_saved_at = clock_timestamp() WHERE id = p_consultation_id;
  RETURN 'saved';
END;
$$;
REVOKE ALL ON FUNCTION public.append_video_consultation_entry(text, uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.append_video_consultation_entry(text, uuid, jsonb) TO service_role;

COMMIT;
