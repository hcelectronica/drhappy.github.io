BEGIN;
DO $$
DECLARE v_id text; v_other text;
BEGIN
  IF has_table_privilege('anon', 'public.patient_receptions', 'SELECT')
    OR has_table_privilege('authenticated', 'public.patient_receptions', 'UPDATE') THEN
    RAISE EXCEPTION 'Reception must be service-role only';
  END IF;
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid='public.patient_receptions'::regclass) THEN
    RAISE EXCEPTION 'Reception RLS missing';
  END IF;
  SELECT id INTO v_id FROM public.professionals WHERE lower(email)='mudimudialan@gmail.com';
  IF v_id IS NULL THEN RAISE EXCEPTION 'Expected professional missing'; END IF;
  DELETE FROM public.patient_receptions WHERE professional_id=v_id;
  INSERT INTO public.patient_receptions(professional_id,slug,display_name,enabled,video)
    VALUES(v_id,'test-reception-sql','Test',true,true);
  BEGIN
    UPDATE public.patient_receptions SET slug='../invalid' WHERE professional_id=v_id;
    RAISE EXCEPTION 'Invalid slug accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  SELECT id INTO v_other FROM public.professionals WHERE id<>v_id LIMIT 1;
  IF v_other IS NOT NULL THEN
    BEGIN
      INSERT INTO public.patient_receptions(professional_id,slug,display_name) VALUES(v_other,'test-reception-sql','Other');
      RAISE EXCEPTION 'Duplicate slug accepted';
    EXCEPTION WHEN unique_violation THEN NULL;
    END;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='public_booking_reservations' AND column_name='consultation_mode' AND column_default LIKE '%presential%') THEN
    RAISE EXCEPTION 'Legacy reservations need presential default';
  END IF;
END $$;
ROLLBACK;
