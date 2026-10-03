CREATE TABLE public.dental_records (
  professional_id text NOT NULL REFERENCES public.professionals(id) ON DELETE CASCADE,
  patient_id text NOT NULL,
  revision integer NOT NULL CHECK (revision > 0),
  record jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (professional_id, patient_id)
);

CREATE TABLE public.dental_record_history (
  professional_id text NOT NULL,
  patient_id text NOT NULL,
  revision integer NOT NULL CHECK (revision > 0),
  record jsonb NOT NULL,
  saved_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (professional_id, patient_id, revision)
);

ALTER TABLE public.dental_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dental_record_history ENABLE ROW LEVEL SECURITY;
-- Supabase default privileges may grant ALL to service_role on new tables.
REVOKE ALL ON public.dental_records, public.dental_record_history FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.dental_records TO service_role;
GRANT SELECT, INSERT ON public.dental_record_history TO service_role;

CREATE FUNCTION public.dental_history_immutable() RETURNS trigger
LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  RAISE EXCEPTION 'El historial odontológico es inmutable' USING ERRCODE = '22023';
END;
$$;
CREATE TRIGGER dental_history_immutable BEFORE UPDATE OR DELETE ON public.dental_record_history
FOR EACH ROW EXECUTE FUNCTION public.dental_history_immutable();

CREATE FUNCTION public.dental_valid_date(p_value text) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE SET search_path = public AS $$
BEGIN
  RETURN COALESCE(p_value ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
    AND to_char(p_value::date, 'YYYY-MM-DD') = p_value, false);
EXCEPTION WHEN OTHERS THEN RETURN false;
END;
$$;

CREATE FUNCTION public.dental_authorize(p_professional_id text) RETURNS void
LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.professionals WHERE id = p_professional_id AND active IS DISTINCT FROM false
      AND translate(lower(specialty), 'áéíóúü', 'aeiouu') LIKE '%odont%'
  ) THEN RAISE EXCEPTION 'Acceso exclusivo para odontología' USING ERRCODE = '42501'; END IF;
END;
$$;

CREATE FUNCTION public.dental_validate(p_record jsonb, p_previous jsonb DEFAULT NULL) RETURNS void
LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  v_item jsonb;
  v_old jsonb;
  v_treatment jsonb;
  v_key text;
  v_collection text;
  v_paid numeric;
  v_tooth integer;
BEGIN
  IF jsonb_typeof(p_record) IS DISTINCT FROM 'object' OR octet_length(p_record::text) > 1048576
    OR p_record->'version' IS DISTINCT FROM '1'::jsonb
    OR COALESCE(p_record->>'status', '') NOT IN ('provisional', 'confirmed')
    OR jsonb_typeof(p_record->'patient') IS DISTINCT FROM 'object'
  THEN RAISE EXCEPTION 'Ficha odontológica v1 inválida' USING ERRCODE = '22023'; END IF;
  FOREACH v_key IN ARRAY ARRAY['name','dni','address','phone','locality','coverage'] LOOP
    IF jsonb_typeof(p_record->'patient'->v_key) IS DISTINCT FROM 'string'
      OR length(p_record->'patient'->>v_key) > 1000
    THEN RAISE EXCEPTION 'Campo de paciente inválido: %', v_key USING ERRCODE = '22023'; END IF;
  END LOOP;
  IF length(trim(p_record->'patient'->>'name')) = 0 THEN
    RAISE EXCEPTION 'El nombre es obligatorio' USING ERRCODE = '22023';
  END IF;
  FOREACH v_key IN ARRAY ARRAY['email','birthDate','memberNumber','nombre','apellido'] LOOP
    IF p_record->'patient' ? v_key AND (jsonb_typeof(p_record->'patient'->v_key) IS DISTINCT FROM 'string'
      OR length(p_record->'patient'->>v_key) > 1000)
    THEN RAISE EXCEPTION 'Campo de paciente inválido: %', v_key USING ERRCODE = '22023'; END IF;
  END LOOP;
  IF (p_record->'patient' ? 'nombre') <> (p_record->'patient' ? 'apellido')
    OR p_record->'patient' ? 'nombre' AND trim(p_record->'patient'->>'name')
      <> trim((p_record->'patient'->>'nombre') || ' ' || (p_record->'patient'->>'apellido'))
      AND trim(p_record->'patient'->>'name')
        <> trim((p_record->'patient'->>'apellido') || ', ' || (p_record->'patient'->>'nombre'))
  THEN RAISE EXCEPTION 'Nombre y apellido deben coincidir con el nombre completo' USING ERRCODE = '22023'; END IF;
  IF COALESCE(p_record->'patient'->>'birthDate', '') <> ''
    AND NOT public.dental_valid_date(p_record->'patient'->>'birthDate')
  THEN RAISE EXCEPTION 'Fecha de nacimiento inválida' USING ERRCODE = '22023'; END IF;
  FOREACH v_key IN ARRAY ARRAY['observations','coverageNotes','consentNotes'] LOOP
    IF jsonb_typeof(p_record->v_key) IS DISTINCT FROM 'string' OR length(p_record->>v_key) > 20000
    THEN RAISE EXCEPTION 'Notas inválidas: %', v_key USING ERRCODE = '22023'; END IF;
  END LOOP;
  FOREACH v_collection IN ARRAY ARRAY['marks','treatments','payments'] LOOP
    IF jsonb_typeof(p_record->v_collection) IS DISTINCT FROM 'array'
    THEN RAISE EXCEPTION 'Lista inválida: %', v_collection USING ERRCODE = '22023'; END IF;
    IF jsonb_array_length(p_record->v_collection) > 2000
    THEN RAISE EXCEPTION 'Demasiados elementos' USING ERRCODE = '22023'; END IF;
    IF EXISTS (SELECT 1 FROM jsonb_array_elements(p_record->v_collection) item
      GROUP BY item->>'id' HAVING count(*) > 1)
    THEN RAISE EXCEPTION 'Identificadores duplicados: %', v_collection USING ERRCODE = '22023'; END IF;
    FOR v_item IN SELECT value FROM jsonb_array_elements(p_record->v_collection) LOOP
      IF jsonb_typeof(v_item) IS DISTINCT FROM 'object'
        OR jsonb_typeof(v_item->'id') IS DISTINCT FROM 'string'
        OR COALESCE(v_item->>'id','') !~ '^[a-zA-Z0-9_-]{1,128}$'
      THEN RAISE EXCEPTION 'Identificador inválido' USING ERRCODE = '22023'; END IF;
      IF v_collection IN ('marks','treatments') THEN
        IF jsonb_typeof(v_item->'tooth') IS DISTINCT FROM 'number'
          OR COALESCE(v_item->>'tooth','') !~ '^[0-9]{2}$'
          OR COALESCE(v_item->>'surface','') NOT IN ('whole','vestibular','oral','mesial','distal','central')
        THEN RAISE EXCEPTION 'Pieza o superficie inválida' USING ERRCODE = '22023'; END IF;
        v_tooth := (v_item->>'tooth')::integer;
        IF NOT ((v_tooth / 10 BETWEEN 1 AND 4 AND v_tooth % 10 BETWEEN 1 AND 8)
          OR (v_tooth / 10 BETWEEN 5 AND 8 AND v_tooth % 10 BETWEEN 1 AND 5))
        THEN RAISE EXCEPTION 'Pieza FDI inválida' USING ERRCODE = '22023'; END IF;
      END IF;
      IF v_collection = 'marks' THEN
        IF COALESCE(v_item->>'condition','') NOT IN ('caries','restoration','unerupted','extraction','missing','fixed','removable','crown')
          OR COALESCE(v_item->>'status','') NOT IN ('existing','needed')
          OR jsonb_typeof(v_item->'note') IS DISTINCT FROM 'string' OR length(v_item->>'note') > 5000
          OR jsonb_typeof(v_item->'createdAt') IS DISTINCT FROM 'string'
          OR COALESCE(v_item->>'createdAt','') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T'
        THEN RAISE EXCEPTION 'Marca inválida' USING ERRCODE = '22023'; END IF;
        BEGIN PERFORM (v_item->>'createdAt')::timestamptz;
        EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION 'Fecha de marca inválida' USING ERRCODE = '22023'; END;
      ELSE
        IF jsonb_typeof(v_item->'date') IS DISTINCT FROM 'string' OR NOT public.dental_valid_date(v_item->>'date')
        THEN RAISE EXCEPTION 'Fecha inválida' USING ERRCODE = '22023'; END IF;
        FOREACH v_key IN ARRAY CASE WHEN v_collection = 'treatments'
          THEN ARRAY['budgetCents','internalCostCents'] ELSE ARRAY['amountCents'] END LOOP
          IF jsonb_typeof(v_item->v_key) IS DISTINCT FROM 'number'
            OR COALESCE(v_item->>v_key,'') !~ '^[0-9]+$'
            OR (v_item->>v_key)::numeric > 9007199254740991
          THEN RAISE EXCEPTION 'Importe debe ser centavos enteros no negativos' USING ERRCODE = '22023'; END IF;
        END LOOP;
        IF v_collection = 'treatments' THEN
          IF jsonb_typeof(v_item->'work') IS DISTINCT FROM 'string' OR length(trim(v_item->>'work')) NOT BETWEEN 1 AND 2000
            OR COALESCE(v_item->>'status','') NOT IN ('proposed','accepted','completed','cancelled')
          THEN RAISE EXCEPTION 'Tratamiento inválido' USING ERRCODE = '22023'; END IF;
          FOREACH v_key IN ARRAY ARRAY['acceptedDate','performedDate'] LOOP
            IF v_item ? v_key AND (jsonb_typeof(v_item->v_key) IS DISTINCT FROM 'string'
              OR NOT public.dental_valid_date(v_item->>v_key) OR v_item->>v_key < v_item->>'date')
            THEN RAISE EXCEPTION 'Fecha de tratamiento inválida' USING ERRCODE = '22023'; END IF;
          END LOOP;
          IF v_item->>'status' IN ('accepted','completed') AND NOT v_item ? 'acceptedDate'
            OR v_item->>'status' = 'completed' AND (NOT v_item ? 'performedDate'
              OR v_item->>'performedDate' < v_item->>'acceptedDate')
          THEN RAISE EXCEPTION 'Fechas de aceptación/realización requeridas' USING ERRCODE = '22023'; END IF;
        ELSE
          SELECT value INTO v_treatment FROM jsonb_array_elements(p_record->'treatments')
            WHERE value->>'id' = v_item->>'treatmentId';
          IF jsonb_typeof(v_item->'treatmentId') IS DISTINCT FROM 'string'
            OR v_treatment IS NULL OR v_treatment->>'status' NOT IN ('accepted','completed')
            OR (v_item->>'amountCents')::numeric <= 0
            OR COALESCE(v_item->>'method','') NOT IN ('Efectivo','Transferencia','Mercado Pago')
            OR v_item->>'date' < COALESCE(v_treatment->>'acceptedDate',v_treatment->>'date')
          THEN RAISE EXCEPTION 'Pago inválido o sin tratamiento aceptado' USING ERRCODE = '22023'; END IF;
        END IF;
      END IF;
    END LOOP;
  END LOOP;
  FOR v_treatment IN SELECT value FROM jsonb_array_elements(p_record->'treatments') LOOP
    SELECT COALESCE(sum((value->>'amountCents')::numeric),0) INTO v_paid
      FROM jsonb_array_elements(p_record->'payments') WHERE value->>'treatmentId' = v_treatment->>'id';
    IF v_paid > (v_treatment->>'budgetCents')::numeric
    THEN RAISE EXCEPTION 'El pago supera el presupuesto' USING ERRCODE = '22023'; END IF;
  END LOOP;
  IF p_previous IS NOT NULL THEN
    FOR v_old IN SELECT value FROM jsonb_array_elements(p_previous->'payments') LOOP
      IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(p_record->'payments') WHERE value = v_old)
      THEN RAISE EXCEPTION 'Los pagos guardados son inmutables' USING ERRCODE = '22023'; END IF;
    END LOOP;
    FOR v_old IN SELECT value FROM jsonb_array_elements(p_previous->'treatments') LOOP
      SELECT value INTO v_treatment FROM jsonb_array_elements(p_record->'treatments')
        WHERE value->>'id' = v_old->>'id';
      IF v_treatment IS NULL THEN
        IF v_old->>'status' <> 'proposed'
        THEN RAISE EXCEPTION 'No se puede eliminar un tratamiento financiero' USING ERRCODE = '22023'; END IF;
        CONTINUE;
      END IF;
      IF NOT (v_treatment->>'status' = v_old->>'status'
        OR v_old->>'status' = 'proposed' AND v_treatment->>'status' IN ('accepted','cancelled')
        OR v_old->>'status' = 'accepted' AND v_treatment->>'status' IN ('completed','cancelled'))
      THEN RAISE EXCEPTION 'Transición de tratamiento inválida' USING ERRCODE = '22023'; END IF;
      IF v_old->>'status' IN ('accepted','completed','cancelled') THEN
        FOREACH v_key IN ARRAY ARRAY['id','date','tooth','surface','work','budgetCents','internalCostCents','acceptedDate'] LOOP
          IF v_treatment->v_key IS DISTINCT FROM v_old->v_key
          THEN RAISE EXCEPTION 'No se puede alterar un tratamiento financiero guardado: %', v_key USING ERRCODE = '22023'; END IF;
        END LOOP;
        IF v_old->>'status' = 'completed' AND v_treatment IS DISTINCT FROM v_old
        THEN RAISE EXCEPTION 'El tratamiento realizado es inmutable' USING ERRCODE = '22023'; END IF;
      END IF;
    END LOOP;
  END IF;
END;
$$;

-- Rebuild from dedicated records, never trust caller-supplied dental ledger entries.
CREATE FUNCTION public.dental_project_ledger(p_professional_id text, p_ledger jsonb) RETURNS jsonb
LANGUAGE sql VOLATILE SET search_path = public AS $$
  SELECT COALESCE((
    SELECT jsonb_agg(item ORDER BY ordinal)
    FROM jsonb_array_elements(COALESCE(p_ledger,'[]'::jsonb)) WITH ORDINALITY a(item,ordinal)
    WHERE COALESCE(item->>'id','') NOT LIKE 'dental:%'
      AND NOT item ? 'dentalRecordPatientId' AND NOT item ? 'dentalTreatmentId'
  ),'[]'::jsonb) || COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'id','dental:' || r.patient_id || ':' || (t->>'id'),
      'patientId',r.patient_id,'patientName',r.record->'patient'->>'name',
      'date',COALESCE(t->>'performedDate',t->>'acceptedDate',t->>'date'),
      'intervention',t->>'work','totalAmount',(t->>'budgetCents')::numeric / 100,
      'paidAmount',COALESCE((SELECT sum((p->>'amountCents')::numeric) FROM jsonb_array_elements(r.record->'payments') p
        WHERE p->>'treatmentId' = t->>'id'),0) / 100,
      'notes','Pieza ' || (t->>'tooth') || ' · ' || (t->>'surface') || ' · Costo interno: ' || ((t->>'internalCostCents')::numeric / 100)::text,
      'dentalRecordPatientId',r.patient_id,'dentalTreatmentId',t->>'id',
      'internalCost',(t->>'internalCostCents')::numeric / 100,
      'createdAt',r.created_at,'updatedAt',r.updated_at
    ) ORDER BY r.patient_id,t->>'id')
    FROM public.dental_records r CROSS JOIN LATERAL jsonb_array_elements(r.record->'treatments') t
    WHERE r.professional_id = p_professional_id AND t->>'status' IN ('accepted','completed')
  ),'[]'::jsonb);
$$;

CREATE FUNCTION public.dental_protect_workspace() RETURNS trigger
LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  v_patient jsonb;
  v_previous jsonb;
  v_record jsonb;
  v_meta jsonb;
  v_patients jsonb := '[]'::jsonb;
  v_key text;
  v_name text;
BEGIN
  IF TG_OP = 'UPDATE' AND EXISTS (
    SELECT 1 FROM public.dental_records r
    JOIN jsonb_array_elements(COALESCE(OLD.patients_json,'[]'::jsonb)) previous ON previous->>'id' = r.patient_id
    WHERE r.professional_id = NEW.user_id
      AND (r.record->>'status' = 'confirmed' OR jsonb_array_length(r.record->'payments') > 0)
      AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(COALESCE(NEW.patients_json,'[]'::jsonb))
        WHERE value->>'id' = r.patient_id)
  ) THEN
    RAISE EXCEPTION 'No se puede eliminar un paciente con ficha confirmada o pagos odontológicos' USING ERRCODE = '22023';
  END IF;
  NEW.treatment_ledger_json := public.dental_project_ledger(NEW.user_id,NEW.treatment_ledger_json);
  FOR v_patient IN SELECT value FROM jsonb_array_elements(COALESCE(NEW.patients_json,'[]'::jsonb)) LOOP
    SELECT record INTO v_record FROM public.dental_records
      WHERE professional_id = NEW.user_id AND patient_id = v_patient->>'id';
    IF v_record IS NOT NULL THEN
      v_meta := v_record->'patient';
      v_previous := NULL;
      IF TG_OP = 'UPDATE' THEN
        SELECT value INTO v_previous FROM jsonb_array_elements(COALESCE(OLD.patients_json,'[]'::jsonb))
          WHERE value->>'id' = v_patient->>'id' LIMIT 1;
      END IF;
      v_name := trim(v_meta->>'name');
      IF v_meta ? 'nombre' AND v_meta ? 'apellido' THEN
        v_patient := v_patient || jsonb_build_object('nombre',v_meta->>'nombre','apellido',v_meta->>'apellido');
      ELSIF strpos(v_name,',') > 0 THEN
        v_patient := v_patient || jsonb_build_object('apellido',trim(split_part(v_name,',',1)),
          'nombre',trim(substr(v_name,strpos(v_name,',') + 1)));
      ELSIF v_previous IS NOT NULL AND v_name = trim(COALESCE(v_previous->>'nombre','') || ' ' || COALESCE(v_previous->>'apellido','')) THEN
        v_patient := v_patient || jsonb_build_object('nombre',v_previous->>'nombre','apellido',v_previous->>'apellido');
      ELSE
        v_patient := v_patient || jsonb_build_object('nombre',split_part(v_name,' ',1),
          'apellido',trim(substr(v_name,length(split_part(v_name,' ',1)) + 1)));
      END IF;
      v_patient := v_patient || jsonb_build_object('dentalStatus',v_record->>'status','dni',v_meta->>'dni',
        'direccion',v_meta->>'address','telefono',v_meta->>'phone','localidad',v_meta->>'locality',
        'obraSocial',v_meta->>'coverage');
      FOREACH v_key IN ARRAY ARRAY['email','birthDate','memberNumber'] LOOP
        IF v_meta ? v_key THEN
          v_patient := v_patient || jsonb_build_object(
            CASE WHEN v_key = 'memberNumber' THEN 'numeroAfiliado' ELSE v_key END,v_meta->>v_key);
        ELSIF v_previous ? (CASE WHEN v_key = 'memberNumber' THEN 'numeroAfiliado' ELSE v_key END) THEN
          v_patient := v_patient || jsonb_build_object(
            CASE WHEN v_key = 'memberNumber' THEN 'numeroAfiliado' ELSE v_key END,
            v_previous->>(CASE WHEN v_key = 'memberNumber' THEN 'numeroAfiliado' ELSE v_key END));
        END IF;
      END LOOP;
      IF v_patient ? 'birthDate' AND public.dental_valid_date(v_patient->>'birthDate') THEN
        v_patient := v_patient || jsonb_build_object('edad',
          greatest(0,date_part('year',age(current_date,(v_patient->>'birthDate')::date))::integer));
      END IF;
    END IF;
    v_patients := v_patients || jsonb_build_array(v_patient);
  END LOOP;
  -- Only protect patients present in this write; do not resurrect deleted patients.
  NEW.patients_json := v_patients;
  RETURN NEW;
END;
$$;
CREATE TRIGGER dental_protect_workspace BEFORE INSERT OR UPDATE ON public.user_workspaces
FOR EACH ROW EXECUTE FUNCTION public.dental_protect_workspace();

CREATE FUNCTION public.dental_merge_ledger(p_professional_id text, p_ledger jsonb) RETURNS jsonb
LANGUAGE plpgsql SET search_path = public AS $$
DECLARE v_result jsonb;
BEGIN
  IF jsonb_typeof(p_ledger) IS DISTINCT FROM 'array'
  THEN RAISE EXCEPTION 'Balance inválido' USING ERRCODE = '22023'; END IF;
  INSERT INTO public.user_workspaces(user_id) VALUES (p_professional_id) ON CONFLICT (user_id) DO NOTHING;
  PERFORM 1 FROM public.user_workspaces WHERE user_id = p_professional_id FOR UPDATE;
  UPDATE public.user_workspaces SET treatment_ledger_json = p_ledger, treatment_ledger_initialized = true
    WHERE user_id = p_professional_id RETURNING treatment_ledger_json INTO v_result;
  RETURN v_result;
END;
$$;

CREATE FUNCTION public.dental_sync_provisional(p_professional_id text) RETURNS jsonb
LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  v_workspace public.user_workspaces%ROWTYPE;
  v_patients jsonb;
  v_appointments jsonb := '[]'::jsonb;
  v_appointment jsonb;
  v_patient jsonb;
  v_dni text;
  v_patient_id text;
  v_name text;
  v_nombre text;
  v_apellido text;
  v_changed boolean := false;
BEGIN
  PERFORM public.dental_authorize(p_professional_id);
  SELECT * INTO v_workspace FROM public.user_workspaces WHERE user_id = p_professional_id FOR UPDATE;
  IF NOT FOUND THEN RETURN NULL; END IF;
  v_patients := COALESCE(v_workspace.patients_json,'[]'::jsonb);
  FOR v_appointment IN SELECT value FROM jsonb_array_elements(COALESCE(v_workspace.appointments_json,'[]'::jsonb)) LOOP
    IF COALESCE(v_appointment->>'status','confirmed') NOT IN ('pending','confirmed')
      OR COALESCE(v_appointment->>'id','') = '' THEN
      v_appointments := v_appointments || jsonb_build_array(v_appointment);
      CONTINUE;
    END IF;
    v_dni := regexp_replace(COALESCE(v_appointment->>'patientDni',''),'[^0-9]','','g');
    IF v_dni <> '' AND EXISTS (
      SELECT 1 FROM jsonb_array_elements(v_patients) WHERE value->>'id' = v_appointment->>'patientId'
        AND regexp_replace(COALESCE(value->>'dni',''),'[^0-9]','','g') <> v_dni
    ) THEN
      -- An explicit conflicting identity must never be silently relinked.
      v_appointments := v_appointments || jsonb_build_array(v_appointment);
      CONTINUE;
    END IF;
    SELECT value INTO v_patient FROM jsonb_array_elements(v_patients)
      WHERE value->>'id' = v_appointment->>'patientId'
        AND (v_dni = '' OR regexp_replace(COALESCE(value->>'dni',''),'[^0-9]','','g') = v_dni)
      LIMIT 1;
    IF v_patient IS NULL AND v_dni <> '' THEN
      SELECT value INTO v_patient FROM jsonb_array_elements(v_patients)
        WHERE regexp_replace(COALESCE(value->>'dni',''),'[^0-9]','','g') = v_dni
        LIMIT 1;
    END IF;
    IF v_patient IS NULL THEN
      IF EXISTS (
        SELECT 1 FROM public.dental_records WHERE professional_id = p_professional_id
          AND (patient_id = v_appointment->>'patientId'
            OR v_dni <> '' AND regexp_replace(record->'patient'->>'dni','[^0-9]','','g') = v_dni)
      ) THEN
        v_appointments := v_appointments || jsonb_build_array(v_appointment);
        CONTINUE;
      END IF;
      v_patient_id := v_appointment->>'patientId';
      IF COALESCE(v_patient_id,'') !~ '^[a-zA-Z0-9_-]{1,128}$'
        OR EXISTS (SELECT 1 FROM jsonb_array_elements(v_patients) WHERE value->>'id' = v_patient_id)
      THEN v_patient_id := gen_random_uuid()::text; END IF;
      v_name := trim(COALESCE(v_appointment->>'patientName',''));
      IF strpos(v_name,',') > 0 THEN
        v_apellido := trim(split_part(v_name,',',1));
        v_nombre := trim(substr(v_name,strpos(v_name,',') + 1));
      ELSE
        v_nombre := split_part(v_name,' ',1);
        v_apellido := trim(substr(v_name,length(v_nombre) + 1));
      END IF;
      v_patient := jsonb_build_object(
        'id',v_patient_id,'ownerUserId',p_professional_id,'nombre',v_nombre,'apellido',v_apellido,
        'dni',COALESCE(v_appointment->>'patientDni',''),'email',COALESCE(v_appointment->>'patientEmail',''),
        'telefono',COALESCE(v_appointment->>'patientPhone',''),'obraSocial','','numeroAfiliado','','plan','',
        'birthDate','','edad',0,'patologiasConocidas','','patologiasCronicas','','ultimaInternacion','',
        'cirugiasPrevias','','direccion','','documents','[]'::jsonb,'consultations','[]'::jsonb,
        'dentalStatus','provisional','createdAt',now(),'updatedAt',now());
      v_patients := v_patients || jsonb_build_array(v_patient);
      v_changed := true;
    END IF;
    IF v_appointment->>'patientId' IS DISTINCT FROM v_patient->>'id' THEN
      v_appointment := v_appointment || jsonb_build_object('patientId',v_patient->>'id');
      v_changed := true;
    END IF;
    v_appointments := v_appointments || jsonb_build_array(v_appointment);
  END LOOP;
  IF v_changed THEN
    UPDATE public.user_workspaces SET patients_json = v_patients, appointments_json = v_appointments
      WHERE user_id = p_professional_id RETURNING * INTO v_workspace;
  END IF;
  RETURN to_jsonb(v_workspace);
END;
$$;

CREATE FUNCTION public.dental_load(p_professional_id text, p_patient_id text) RETURNS jsonb
LANGUAGE plpgsql SET search_path = public AS $$
DECLARE v_workspace public.user_workspaces%ROWTYPE; v_patient jsonb; v_row public.dental_records%ROWTYPE;
BEGIN
  PERFORM public.dental_authorize(p_professional_id);
  PERFORM public.dental_sync_provisional(p_professional_id);
  SELECT * INTO v_workspace FROM public.user_workspaces WHERE user_id = p_professional_id;
  SELECT value INTO v_patient FROM jsonb_array_elements(COALESCE(v_workspace.patients_json,'[]'::jsonb))
    WHERE value->>'id' = p_patient_id;
  IF v_patient IS NULL THEN RAISE EXCEPTION 'Paciente no encontrado' USING ERRCODE = 'P0002'; END IF;
  SELECT * INTO v_row FROM public.dental_records WHERE professional_id = p_professional_id AND patient_id = p_patient_id;
  RETURN jsonb_build_object('success',true,'record',v_row.record,'revision',COALESCE(v_row.revision,0),
    'patient',v_patient,'appointments',v_workspace.appointments_json,'treatmentLedger',v_workspace.treatment_ledger_json,
    'history',COALESCE((SELECT jsonb_agg(jsonb_build_object('revision',revision,'createdAt',saved_at,
      'confirmed',record->>'status' = 'confirmed') ORDER BY revision DESC)
      FROM public.dental_record_history WHERE professional_id = p_professional_id AND patient_id = p_patient_id),'[]'::jsonb));
END;
$$;

CREATE FUNCTION public.dental_save(
  p_professional_id text, p_patient_id text, p_record jsonb, p_expected_revision integer,
  p_confirm boolean DEFAULT false, p_appointment_id text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  v_workspace public.user_workspaces%ROWTYPE;
  v_row public.dental_records%ROWTYPE;
  v_patient jsonb;
  v_meta jsonb;
  v_appointment jsonb;
  v_revision integer;
  v_name text;
  v_key text;
  v_dni text;
BEGIN
  PERFORM public.dental_authorize(p_professional_id);
  SELECT * INTO v_workspace FROM public.user_workspaces WHERE user_id = p_professional_id FOR UPDATE;
  SELECT value INTO v_patient FROM jsonb_array_elements(COALESCE(v_workspace.patients_json,'[]'::jsonb))
    WHERE value->>'id' = p_patient_id;
  IF v_patient IS NULL THEN RAISE EXCEPTION 'Paciente no encontrado' USING ERRCODE = 'P0002'; END IF;
  SELECT * INTO v_row FROM public.dental_records
    WHERE professional_id = p_professional_id AND patient_id = p_patient_id FOR UPDATE;
  IF p_expected_revision IS NULL OR p_expected_revision < 0 OR p_expected_revision <> COALESCE(v_row.revision,0)
  THEN RAISE EXCEPTION 'revision_conflict' USING ERRCODE = 'PT409'; END IF;
  PERFORM public.dental_validate(p_record,v_row.record);
  IF p_confirm IS NULL OR p_record->>'status' <> (CASE WHEN p_confirm THEN 'confirmed' ELSE 'provisional' END)
  THEN RAISE EXCEPTION 'El estado de ficha no coincide con confirm' USING ERRCODE = '22023'; END IF;
  v_meta := p_record->'patient';
  v_dni := regexp_replace(COALESCE(v_row.record->'patient'->>'dni',v_patient->>'dni',''),'[^0-9]','','g');
  IF v_dni <> '' AND regexp_replace(v_meta->>'dni','[^0-9]','','g') <> v_dni
  THEN RAISE EXCEPTION 'El DNI del paciente es inmutable' USING ERRCODE = '22023'; END IF;
  IF v_dni <> '' THEN
    v_meta := jsonb_set(v_meta,'{dni}',to_jsonb(COALESCE(v_row.record->'patient'->>'dni',v_patient->>'dni','')));
  ELSE
    v_dni := regexp_replace(v_meta->>'dni','[^0-9]','','g');
    IF v_meta->>'dni' <> '' AND (v_meta->>'dni' !~ '^[0-9. -]+$' OR v_dni !~ '^[0-9]{7,8}$') THEN
      RAISE EXCEPTION 'DNI inválido: usá 7 u 8 dígitos' USING ERRCODE = '22023';
    END IF;
    IF v_dni <> '' AND (
      EXISTS (SELECT 1 FROM jsonb_array_elements(v_workspace.patients_json) WHERE value->>'id' <> p_patient_id
        AND regexp_replace(COALESCE(value->>'dni',''),'[^0-9]','','g') = v_dni)
      OR EXISTS (SELECT 1 FROM public.dental_records WHERE professional_id = p_professional_id
        AND patient_id <> p_patient_id AND regexp_replace(record->'patient'->>'dni','[^0-9]','','g') = v_dni)
    ) THEN
      RAISE EXCEPTION 'El DNI ya corresponde a otro paciente' USING ERRCODE = '22023';
    END IF;
    v_meta := jsonb_set(v_meta,'{dni}',to_jsonb(v_dni));
  END IF;
  p_record := jsonb_set(p_record,'{patient}',v_meta);
  IF p_confirm AND v_dni !~ '^[0-9]{7,8}$' THEN
    RAISE EXCEPTION 'Para confirmar indicá un DNI válido de 7 u 8 dígitos' USING ERRCODE = '22023';
  END IF;
  IF p_appointment_id IS NOT NULL THEN
    IF NOT p_confirm THEN RAISE EXCEPTION 'Solo la confirmación puede atender un turno' USING ERRCODE = '22023'; END IF;
    SELECT value INTO v_appointment FROM jsonb_array_elements(v_workspace.appointments_json)
      WHERE value->>'id' = p_appointment_id;
    IF v_appointment IS NULL OR v_appointment->>'status' = 'cancelled'
      OR NOT (COALESCE(v_appointment->>'patientId','') = p_patient_id
        OR COALESCE(v_appointment->>'patientId','') = '' AND v_dni <> ''
          AND regexp_replace(COALESCE(v_appointment->>'patientDni',''),'[^0-9]','','g') = v_dni)
    THEN RAISE EXCEPTION 'El turno no corresponde al paciente' USING ERRCODE = '22023'; END IF;
    SELECT jsonb_agg(CASE WHEN value->>'id' = p_appointment_id
      THEN value || '{"status":"attended"}'::jsonb ELSE value END ORDER BY ordinal)
    INTO v_workspace.appointments_json
    FROM jsonb_array_elements(v_workspace.appointments_json) WITH ORDINALITY a(value,ordinal);
  END IF;
  v_name := trim(v_meta->>'name');
  -- Keep existing name components if the displayed full name did not change.
  IF v_meta ? 'nombre' AND v_meta ? 'apellido' THEN
    v_patient := v_patient || jsonb_build_object('nombre',v_meta->>'nombre','apellido',v_meta->>'apellido');
  ELSIF strpos(v_name,',') > 0 THEN
    v_patient := v_patient || jsonb_build_object('apellido',trim(split_part(v_name,',',1)),
      'nombre',trim(substr(v_name,strpos(v_name,',') + 1)));
  ELSIF v_name <> trim(COALESCE(v_patient->>'nombre','') || ' ' || COALESCE(v_patient->>'apellido','')) THEN
    v_patient := v_patient || jsonb_build_object('nombre',split_part(v_name,' ',1),
      'apellido',trim(substr(v_name,length(split_part(v_name,' ',1)) + 1)));
  END IF;
  IF p_confirm AND (COALESCE(trim(v_patient->>'nombre'),'') = '' OR COALESCE(trim(v_patient->>'apellido'),'') = '') THEN
    RAISE EXCEPTION 'Para confirmar indicá nombre y apellido' USING ERRCODE = '22023';
  END IF;
  v_patient := v_patient || jsonb_build_object('dni',v_meta->>'dni','direccion',v_meta->>'address',
    'telefono',v_meta->>'phone','localidad',v_meta->>'locality','obraSocial',v_meta->>'coverage',
    'dentalStatus',p_record->>'status','updatedAt',now());
  FOREACH v_key IN ARRAY ARRAY['email','birthDate','memberNumber'] LOOP
    IF v_meta ? v_key THEN v_patient := v_patient || jsonb_build_object(
      CASE WHEN v_key = 'memberNumber' THEN 'numeroAfiliado' ELSE v_key END,v_meta->>v_key); END IF;
  END LOOP;
  IF v_meta ? 'birthDate' THEN
    v_patient := v_patient || jsonb_build_object('edad',CASE WHEN v_meta->>'birthDate' = '' THEN 0
      ELSE greatest(0,date_part('year',age(current_date,(v_meta->>'birthDate')::date))::integer) END);
  END IF;
  v_revision := COALESCE(v_row.revision,0) + 1;
  INSERT INTO public.dental_records(professional_id,patient_id,revision,record)
    VALUES (p_professional_id,p_patient_id,v_revision,p_record)
    ON CONFLICT (professional_id,patient_id) DO UPDATE SET revision = EXCLUDED.revision,
      record = EXCLUDED.record, updated_at = now();
  INSERT INTO public.dental_record_history(professional_id,patient_id,revision,record)
    VALUES (p_professional_id,p_patient_id,v_revision,p_record);
  UPDATE public.user_workspaces SET
    patients_json = (SELECT jsonb_agg(CASE WHEN value->>'id' = p_patient_id THEN v_patient ELSE value END ORDER BY ordinal)
      FROM jsonb_array_elements(v_workspace.patients_json) WITH ORDINALITY a(value,ordinal)),
    appointments_json = v_workspace.appointments_json, treatment_ledger_initialized = true
  WHERE user_id = p_professional_id;
  RETURN public.dental_load(p_professional_id,p_patient_id);
END;
$$;

REVOKE ALL ON FUNCTION public.dental_history_immutable(), public.dental_valid_date(text),
  public.dental_authorize(text), public.dental_validate(jsonb,jsonb), public.dental_project_ledger(text,jsonb),
  public.dental_protect_workspace(), public.dental_merge_ledger(text,jsonb), public.dental_sync_provisional(text), public.dental_load(text,text),
  public.dental_save(text,text,jsonb,integer,boolean,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.dental_valid_date(text), public.dental_authorize(text),
  public.dental_validate(jsonb,jsonb), public.dental_project_ledger(text,jsonb),
  public.dental_merge_ledger(text,jsonb), public.dental_sync_provisional(text), public.dental_load(text,text),
  public.dental_save(text,text,jsonb,integer,boolean,text) TO service_role;
