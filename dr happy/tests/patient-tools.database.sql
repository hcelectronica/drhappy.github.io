BEGIN;
DO $$
DECLARE
  patient uuid;
  campaign uuid := gen_random_uuid();
  owner_id text;
  recipients jsonb;
  n integer;
BEGIN
  SELECT professional_id INTO STRICT owner_id FROM public.patient_communication_admins;
  IF (SELECT data_type FROM information_schema.columns WHERE table_schema='public' AND table_name='professionals' AND column_name='id') <> 'text' THEN
    RAISE EXCEPTION 'Unexpected professional ID type';
  END IF;
  IF has_table_privilege('anon','public.patient_glucose_readings','SELECT')
    OR has_table_privilege('authenticated','public.patient_diabetes_profiles','UPDATE')
    OR has_table_privilege('authenticated','public.patient_email_preferences','SELECT')
    OR has_table_privilege('anon','public.patient_email_recipients','SELECT')
    OR has_function_privilege('authenticated','public.claim_patient_email_batch(uuid,text)','EXECUTE') THEN
    RAISE EXCEPTION 'Patient data exposed';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_class WHERE oid IN ('public.patient_glucose_readings'::regclass,'public.patient_diabetes_profiles'::regclass,
    'public.patient_email_campaigns'::regclass,'public.patient_email_preferences'::regclass,'public.patient_email_recipients'::regclass) AND NOT relrowsecurity) THEN
    RAISE EXCEPTION 'RLS missing';
  END IF;
  INSERT INTO public.patient_accounts(email,password_hash,full_name,dni,consent_accepted_at)
    VALUES ('glucose-' || gen_random_uuid() || '@example.invalid','not-a-password','Glucose fixture','00000000',now()) RETURNING id INTO patient;
  INSERT INTO public.patient_glucose_readings(patient_id,measured_at,value,context,method)
    VALUES(patient,now(),110,'fasting','capillary');
  BEGIN
    INSERT INTO public.patient_glucose_readings(patient_id,measured_at,value,context,method) VALUES(patient,now(),0,'fasting','capillary');
    RAISE EXCEPTION 'Invalid glucose accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  IF (SELECT column_default FROM information_schema.columns WHERE table_schema='public' AND table_name='patient_shares' AND column_name='include_glucose') <> 'false' THEN
    RAISE EXCEPTION 'Existing shares broadened';
  END IF;
  PERFORM public.record_patient_activity(patient,'view','glucose');
  SELECT jsonb_agg(jsonb_build_object('email','campaign-' || i || '@example.invalid','name','Fixture')) INTO recipients FROM generate_series(1,12) i;
  PERFORM public.create_patient_email_campaign(campaign,owner_id,'own','folder','Fixture','Fixture','https://www.drhappy.com.ar/paciente',recipients);
  PERFORM public.create_patient_email_campaign(campaign,owner_id,'own','folder','Changed','Changed','https://example.invalid','[]'::jsonb);
  IF (SELECT subject FROM public.patient_email_campaigns WHERE id=campaign) <> 'Fixture'
    OR (SELECT count(*) FROM public.patient_email_recipients WHERE campaign_id=campaign) <> 12 THEN RAISE EXCEPTION 'Snapshot is not idempotent'; END IF;
  SELECT count(*) INTO n FROM public.claim_patient_email_batch(campaign,owner_id);
  IF n <> 0 THEN RAISE EXCEPTION 'Draft sent without confirmation'; END IF;
  UPDATE public.patient_email_campaigns SET status='active' WHERE id=campaign;
  SELECT count(*) INTO n FROM public.claim_patient_email_batch(campaign,'another-professional');
  IF n <> 0 THEN RAISE EXCEPTION 'Other owner claimed campaign'; END IF;
  SELECT count(*) INTO n FROM public.claim_patient_email_batch(campaign,owner_id);
  IF n <> 5 THEN RAISE EXCEPTION 'Expected first batch of five'; END IF;
  UPDATE public.patient_email_recipients SET status='uncertain' WHERE campaign_id=campaign AND status='sending';
  SELECT count(*) INTO n FROM public.claim_patient_email_batch(campaign,owner_id);
  IF n <> 5 THEN RAISE EXCEPTION 'Expected second batch of five'; END IF;
  SELECT count(*) INTO n FROM public.claim_patient_email_batch(campaign,owner_id);
  IF n <> 2 THEN RAISE EXCEPTION 'Recipients repeated or lost'; END IF;
  SELECT count(*) INTO n FROM public.claim_patient_email_batch(campaign,owner_id);
  IF n <> 0 THEN RAISE EXCEPTION 'Claim repeated nonpending recipients'; END IF;
END $$;
ROLLBACK;
