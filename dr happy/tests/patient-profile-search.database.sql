BEGIN;
DO $$
DECLARE
  v_prefix text := 'name-search-' || gen_random_uuid()::text;
  v_patient uuid := gen_random_uuid();
  v_count integer;
BEGIN
  IF has_function_privilege('anon', 'public.search_patient_professionals(text)', 'EXECUTE')
    OR has_function_privilege('authenticated', 'public.search_patient_professionals(text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'Search RPC must be service-only';
  END IF;
  INSERT INTO public.professionals(id,username,full_name,specialty,license_number,email,active,is_admin)
    VALUES(v_prefix,v_prefix,'Zzqprueba María Gómez','Clínica médica','TEST',v_prefix || '@example.invalid',true,false),
      (v_prefix || '-inactive',v_prefix || '-inactive','Zzqprueba María Gómez','Clínica médica','TEST',v_prefix || '-inactive@example.invalid',false,false);
  IF NOT EXISTS (SELECT 1 FROM public.search_patient_professionals('gome zzqprue maria') WHERE id=v_prefix) THEN
    RAISE EXCEPTION 'Partial, accent-insensitive and reversed name order must match';
  END IF;
  IF EXISTS (SELECT 1 FROM public.search_patient_professionals('zzqprue') WHERE id=v_prefix || '-inactive') THEN
    RAISE EXCEPTION 'Inactive professional returned';
  END IF;
  IF EXISTS (SELECT 1 FROM public.search_patient_professionals('%_')) THEN
    RAISE EXCEPTION 'Wildcards must not enumerate professionals';
  END IF;
  IF EXISTS (SELECT 1 FROM public.search_patient_professionals('z')) THEN
    RAISE EXCEPTION 'One-letter lookup must not return results';
  END IF;
  INSERT INTO public.professionals(id,username,full_name,specialty,license_number,email,active,is_admin)
    SELECT v_prefix || '-' || n, v_prefix || '-' || n, 'Zzqprueba Nombre ' || n, 'Clínica','TEST',v_prefix || '-' || n || '@example.invalid',true,false
    FROM generate_series(1,14) n;
  SELECT count(*) INTO v_count FROM public.search_patient_professionals('zzqprue');
  IF v_count <> 11 THEN RAISE EXCEPTION 'Search must be bounded to 11 rows, got %',v_count; END IF;
  INSERT INTO public.patient_accounts(id,email,password_hash,full_name,dni,email_verified_at,consent_accepted_at,health_insurance,insurance_member_number)
    VALUES(v_patient,v_prefix || '@example.invalid','fixture-not-a-password','Prueba','00000001',now(),now(),'OSDE','000123/45-A');
  IF NOT EXISTS (SELECT 1 FROM public.patient_accounts WHERE id=v_patient AND insurance_member_number='000123/45-A') THEN
    RAISE EXCEPTION 'Insurance member identifier altered';
  END IF;
  BEGIN
    UPDATE public.patient_accounts SET health_insurance=repeat('x',121) WHERE id=v_patient;
    RAISE EXCEPTION 'Oversized insurance accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    UPDATE public.patient_accounts SET insurance_member_number=repeat('x',81) WHERE id=v_patient;
    RAISE EXCEPTION 'Oversized member identifier accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
END $$;
ROLLBACK;
