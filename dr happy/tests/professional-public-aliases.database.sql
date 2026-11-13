BEGIN;
DO $$
DECLARE
  v_owner TEXT := gen_random_uuid()::text;
  v_other TEXT := gen_random_uuid()::text;
  v_suffix TEXT := left(replace(gen_random_uuid()::text, '-', ''), 10);
  v_first TEXT;
  v_second TEXT;
  v_preserved JSONB;
BEGIN
  IF has_table_privilege('anon', 'public.professional_public_aliases', 'SELECT')
    OR has_table_privilege('authenticated', 'public.professional_public_aliases', 'UPDATE')
    OR has_function_privilege('anon', 'public.ensure_professional_public_alias(text)', 'EXECUTE')
    OR has_function_privilege('authenticated', 'public.claim_professional_public_alias(text,text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'Alias data and RPCs must be server-only';
  END IF;
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.professional_public_aliases'::regclass) THEN
    RAISE EXCEPTION 'Alias RLS missing';
  END IF;
  INSERT INTO public.professionals(id, username, full_name, specialty, license_number, email)
    VALUES (v_owner, 'fixture-' || v_owner, 'Doctora Fixture ' || v_suffix, 'Test', 'TEST', v_owner || '@example.invalid'),
           (v_other, 'fixture-' || v_other, 'Doctora Fixture ' || v_suffix, 'Test', 'TEST', v_other || '@example.invalid');
  v_first := public.ensure_professional_public_alias(v_owner);
  v_second := public.ensure_professional_public_alias(v_other);
  IF v_first = v_second OR v_first NOT LIKE 'doctora-fixture-%' THEN
    RAISE EXCEPTION 'Identity-based aliases must be unique';
  END IF;
  IF public.ensure_professional_public_alias(v_owner) <> v_first THEN
    RAISE EXCEPTION 'Alias changed on repeated load';
  END IF;
  IF EXISTS(SELECT 1 FROM public.patient_receptions WHERE professional_id IN (v_owner, v_other))
    OR EXISTS(SELECT 1 FROM public.public_booking_profiles WHERE professional_id IN (v_owner, v_other))
    OR EXISTS(SELECT 1 FROM public.patient_invite_links WHERE professional_id IN (v_owner, v_other)) THEN
    RAISE EXCEPTION 'Alias creation must not initialize tools';
  END IF;
  INSERT INTO public.public_booking_profiles(professional_id, slug, enabled, professional_name, availability_blocks)
    VALUES(v_owner, 'legacy-' || v_suffix, false, 'Fixture', '[]'::jsonb);
  SELECT to_jsonb(p) INTO v_preserved FROM public.public_booking_profiles p WHERE professional_id = v_owner;
  INSERT INTO public.patient_receptions(professional_id, slug, display_name, enabled)
    VALUES(v_owner, 'custom-' || v_suffix, 'Fixture', false);
  UPDATE public.patient_receptions SET slug = 'renamed-' || v_suffix WHERE professional_id = v_owner;
  IF NOT EXISTS(SELECT 1 FROM public.professional_public_aliases WHERE alias = v_first AND professional_id = v_owner AND NOT is_primary)
    OR NOT EXISTS(SELECT 1 FROM public.professional_public_aliases WHERE alias = 'custom-' || v_suffix AND professional_id = v_owner AND NOT is_primary)
    OR public.ensure_professional_public_alias(v_owner) <> 'renamed-' || v_suffix THEN
    RAISE EXCEPTION 'Primary and historical aliases not preserved';
  END IF;
  IF (SELECT to_jsonb(p) FROM public.public_booking_profiles p WHERE professional_id = v_owner) <> v_preserved THEN
    RAISE EXCEPTION 'Alias edits changed legacy booking configuration';
  END IF;
  BEGIN
    PERFORM public.claim_professional_public_alias(v_other, 'legacy-' || v_suffix);
    RAISE EXCEPTION 'Another owner took over a legacy URL';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;
  BEGIN
    UPDATE public.patient_receptions SET slug = v_second WHERE professional_id = v_owner;
    RAISE EXCEPTION 'Another owner took over a public alias';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;
  IF public.ensure_professional_public_alias(v_owner) <> 'renamed-' || v_suffix THEN
    RAISE EXCEPTION 'Failed alias change was not atomic';
  END IF;
  BEGIN
    INSERT INTO public.patient_invite_links(professional_id, token) VALUES(v_other, v_first);
    RAISE EXCEPTION 'A new legacy token took over an old alias';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;
END;
$$;
ROLLBACK;
