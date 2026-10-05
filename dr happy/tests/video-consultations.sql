BEGIN;
DO $test$
DECLARE
  v_id text := gen_random_uuid()::text;
  v_consultation uuid;
  v_started timestamptz;
  v_ended timestamptz;
  v_hash text := encode(gen_random_bytes(32), 'hex');
BEGIN
  INSERT INTO public.professionals(id, username, full_name, specialty, license_number, email, active, is_admin)
    VALUES(v_id, 'test-video-' || v_id, 'Video consultation test', 'Test', 'TEST', v_id || '@example.invalid', true, true);
  INSERT INTO public.video_consultations(professional_id, patient_id, duration_minutes, lifecycle_hash)
    VALUES(v_id, 'fixture-patient', 40, v_hash) RETURNING id INTO v_consultation;
  ASSERT public.advance_video_consultation(v_hash, 'start');
  SELECT started_at INTO v_started FROM public.video_consultations WHERE id = v_consultation;
  ASSERT v_started IS NOT NULL;
  ASSERT public.advance_video_consultation(v_hash, 'start');
  ASSERT (SELECT started_at = v_started FROM public.video_consultations WHERE id = v_consultation);
  ASSERT public.advance_video_consultation(v_hash, 'completed');
  SELECT ended_at INTO v_ended FROM public.video_consultations WHERE id = v_consultation;
  ASSERT v_ended IS NOT NULL;
  ASSERT NOT public.advance_video_consultation(v_hash, 'start');
  ASSERT public.advance_video_consultation(v_hash, 'interrupted');
  ASSERT (SELECT ended_at = v_ended AND status = 'completed' FROM public.video_consultations WHERE id = v_consultation);
  ASSERT NOT public.advance_video_consultation(repeat('0',64), 'start');
  INSERT INTO public.video_consultations(professional_id,patient_id,duration_minutes,lifecycle_hash,created_at)
    VALUES(v_id,'fixture-patient',40,encode(gen_random_bytes(32),'hex'),clock_timestamp() - interval '31 minutes');
  PERFORM public.reconcile_video_consultations(v_id);
  ASSERT (SELECT count(*) = 1 FROM public.video_consultations WHERE professional_id = v_id AND status = 'expired');
  ASSERT NOT has_table_privilege('anon','public.video_consultations','SELECT');
  ASSERT NOT has_table_privilege('authenticated','public.video_consultations','INSERT');
  ASSERT NOT has_function_privilege('anon','public.advance_video_consultation(text,text)','EXECUTE');
  ASSERT NOT has_function_privilege('authenticated','public.reconcile_video_consultations(text)','EXECUTE');
END;
$test$;
ROLLBACK;
