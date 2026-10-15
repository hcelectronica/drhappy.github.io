BEGIN;
DO $$
DECLARE
  baseline BIGINT := (public.patient_admin_stats(0)->'summary'->>'total')::bigint;
  patient UUID;
  stats JSONB;
  day DATE := (now() AT TIME ZONE 'America/Argentina/Buenos_Aires')::date;
BEGIN
  INSERT INTO public.patient_accounts(email,password_hash,full_name,dni,consent_accepted_at)
  SELECT 'monitoring-fixture-' || gen_random_uuid() || '@example.invalid',
    'not-a-real-password','Monitoring fixture','00000000',now()
  FROM generate_series(1,1005);
  stats := public.patient_admin_stats(0);
  IF (stats->'summary'->>'total')::bigint <> baseline + 1005 THEN RAISE EXCEPTION 'Totals truncated'; END IF;
  IF jsonb_array_length(stats->'recent') <> 50 THEN RAISE EXCEPTION 'Pagination failed'; END IF;
  IF jsonb_array_length(stats->'daily') <> 30 THEN RAISE EXCEPTION 'Daily shape failed'; END IF;
  SELECT id INTO patient FROM public.patient_accounts WHERE email LIKE 'monitoring-fixture-%@example.invalid' LIMIT 1;
  UPDATE public.patient_accounts SET email_verified_at=now() WHERE id=patient;
  UPDATE public.patient_accounts SET email_verified_at=now() WHERE id=patient;
  IF (SELECT count(*) FROM public.patient_registration_notices WHERE patient_id=patient) <> 1 THEN
    RAISE EXCEPTION 'Verification notice not unique';
  END IF;
  PERFORM public.record_patient_activity(patient,'heartbeat');
  PERFORM public.record_patient_activity(patient,'heartbeat');
  IF (SELECT active_minutes FROM public.patient_daily_activity WHERE patient_id=patient AND activity_date=day) <> 0 THEN
    RAISE EXCEPTION 'Instant heartbeat overcounts';
  END IF;
  UPDATE public.patient_daily_activity SET last_heartbeat_at=now()-interval '60 seconds' WHERE patient_id=patient;
  PERFORM public.record_patient_activity(patient,'heartbeat');
  PERFORM public.record_patient_activity(patient,'heartbeat');
  IF (SELECT active_minutes FROM public.patient_daily_activity WHERE patient_id=patient AND activity_date=day) <> 1 THEN
    RAISE EXCEPTION 'Multiple tabs overcount';
  END IF;
  UPDATE public.patient_daily_activity SET last_heartbeat_at=now()-interval '10 minutes' WHERE patient_id=patient;
  PERFORM public.record_patient_activity(patient,'heartbeat');
  IF (SELECT active_minutes FROM public.patient_daily_activity WHERE patient_id=patient AND activity_date=day) <> 1 THEN
    RAISE EXCEPTION 'Absence counted as activity';
  END IF;
  PERFORM public.record_patient_activity(patient,'view','memory');
  PERFORM public.record_patient_activity(patient,'game_completed');
  PERFORM public.record_patient_activity(patient,'invite_clicked');
  IF (SELECT features FROM public.patient_daily_activity WHERE patient_id=patient AND activity_date=day)
    <> '{"memory":1,"game_completed":1,"invite_clicked":1}'::jsonb THEN RAISE EXCEPTION 'Feature counts failed'; END IF;
  BEGIN
    PERFORM public.record_patient_activity(patient,'view','private-data');
    RAISE EXCEPTION 'Invalid feature accepted';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM = 'Invalid feature accepted' THEN RAISE; END IF;
  END;
  IF has_function_privilege('anon','public.patient_admin_stats(integer)','EXECUTE')
    OR has_function_privilege('authenticated','public.record_patient_activity(uuid,text,text)','EXECUTE')
    OR has_table_privilege('anon','public.patient_registration_notices','SELECT') THEN
    RAISE EXCEPTION 'Monitoring data exposed';
  END IF;
  IF stats::text LIKE '%password_hash%' OR stats::text LIKE '%systolic%' OR stats::text LIKE '%dni%' THEN
    RAISE EXCEPTION 'Private fields exposed';
  END IF;
END;
$$;
ROLLBACK;
