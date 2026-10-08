-- Un conflicto de versión es definitivo, no un fallo transitorio reintentable.
DO $$
DECLARE signature regprocedure; definition text;
BEGIN
  FOREACH signature IN ARRAY ARRAY[
    'public.protect_clinical_consultations()'::regprocedure,
    'public.correct_clinical_consultation(text,text,text,text,jsonb)'::regprocedure
  ] LOOP
    SELECT pg_get_functiondef(signature) INTO definition;
    EXECUTE replace(definition, 'ERRCODE = ''40001''', 'ERRCODE = ''23505''');
  END LOOP;
END $$;
