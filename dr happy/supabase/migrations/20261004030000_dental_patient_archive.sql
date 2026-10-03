CREATE TABLE public.dental_patient_archives (
  professional_id text NOT NULL REFERENCES public.professionals(id) ON DELETE CASCADE,
  patient_id text NOT NULL,
  state text NOT NULL CHECK (state IN ('active', 'archived', 'confirmed')),
  patient jsonb NOT NULL CHECK (jsonb_typeof(patient) = 'object'),
  archived_at timestamptz NOT NULL DEFAULT now(),
  confirmed_at timestamptz,
  restored_at timestamptz,
  PRIMARY KEY (professional_id, patient_id)
);
ALTER TABLE public.dental_patient_archives ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.dental_patient_archives FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.dental_patient_archives TO service_role;

CREATE FUNCTION public.dental_archive_patient(p_professional_id text, p_patient_id text, p_action text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_workspace public.user_workspaces%ROWTYPE;
  v_archive public.dental_patient_archives%ROWTYPE;
  v_patient jsonb;
  v_dni text;
BEGIN
  PERFORM public.dental_authorize(p_professional_id);
  SELECT * INTO v_workspace FROM public.user_workspaces WHERE user_id = p_professional_id FOR UPDATE;
  SELECT value INTO v_patient FROM jsonb_array_elements(COALESCE(v_workspace.patients_json, '[]'::jsonb))
    WHERE value->>'id' = p_patient_id AND value->>'ownerUserId' = p_professional_id;
  IF v_patient IS NULL THEN RAISE EXCEPTION 'Paciente propio no encontrado' USING ERRCODE = 'P0002'; END IF;
  SELECT * INTO v_archive FROM public.dental_patient_archives
    WHERE professional_id = p_professional_id AND patient_id = p_patient_id FOR UPDATE;
  IF p_action = 'archive' THEN
    IF COALESCE(v_archive.state, 'active') <> 'active' THEN
      RAISE EXCEPTION 'El paciente ya está archivado' USING ERRCODE = '22023';
    END IF;
    v_dni := regexp_replace(COALESCE(v_patient->>'dni', ''), '[^0-9]', '', 'g');
    IF EXISTS (
      SELECT 1 FROM jsonb_array_elements(COALESCE(v_workspace.appointments_json, '[]'::jsonb)) a
      WHERE COALESCE(a->>'status', '') NOT IN ('cancelled', 'attended')
        AND (a->>'patientId' = p_patient_id OR v_dni <> '' AND regexp_replace(COALESCE(a->>'patientDni', ''), '[^0-9]', '', 'g') = v_dni)
        AND ((a->>'scheduledDate') || ' ' || (a->>'scheduledTime'))::timestamp >= timezone('America/Argentina/Buenos_Aires', now())
    ) OR EXISTS (
      SELECT 1 FROM public.public_booking_reservations r WHERE r.professional_id = p_professional_id
        AND r.status IN ('confirmed', 'pending_payment') AND v_dni <> ''
        AND regexp_replace(COALESCE(r.patient_dni, ''), '[^0-9]', '', 'g') = v_dni
        AND (r.slot_date::text || ' ' || r.slot_time::text)::timestamp >= timezone('America/Argentina/Buenos_Aires', now())
    ) THEN RAISE EXCEPTION 'Cancelá los turnos pendientes de este paciente antes de archivarlo' USING ERRCODE = '22023'; END IF;
    INSERT INTO public.dental_patient_archives(professional_id, patient_id, state, patient)
      VALUES (p_professional_id, p_patient_id, 'archived', v_patient)
      ON CONFLICT (professional_id, patient_id) DO UPDATE SET state = 'archived', patient = EXCLUDED.patient,
        archived_at = now(), confirmed_at = NULL, restored_at = NULL;
  ELSIF p_action IN ('restore', 'confirm') THEN
    IF v_archive.state IS DISTINCT FROM 'archived' THEN
      RAISE EXCEPTION 'La acción requiere un paciente pendiente en Pacientes eliminados' USING ERRCODE = '22023';
    END IF;
    UPDATE public.dental_patient_archives SET state = CASE WHEN p_action = 'restore' THEN 'active' ELSE 'confirmed' END,
      confirmed_at = CASE WHEN p_action = 'confirm' THEN now() ELSE NULL END,
      restored_at = CASE WHEN p_action = 'restore' THEN now() ELSE NULL END
      WHERE professional_id = p_professional_id AND patient_id = p_patient_id;
  ELSE RAISE EXCEPTION 'Acción de archivo inválida' USING ERRCODE = '22023';
  END IF;
  RETURN jsonb_build_object('success', true);
END;
$$;

CREATE FUNCTION public.dental_preserve_archived_patients() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_archive public.dental_patient_archives%ROWTYPE;
BEGIN
  FOR v_archive IN SELECT * FROM public.dental_patient_archives
    WHERE professional_id = NEW.user_id
  LOOP
    IF v_archive.state = 'active' AND EXISTS (SELECT 1 FROM jsonb_array_elements(COALESCE(NEW.patients_json, '[]'::jsonb))
      WHERE value->>'id' = v_archive.patient_id) THEN
      UPDATE public.dental_patient_archives SET patient = (SELECT value
        FROM jsonb_array_elements(NEW.patients_json) WHERE value->>'id' = v_archive.patient_id LIMIT 1)
        WHERE professional_id = NEW.user_id AND patient_id = v_archive.patient_id;
      CONTINUE;
    END IF;
    IF v_archive.state <> 'active' AND COALESCE(v_archive.patient->>'dni', '') <> '' AND EXISTS (
      SELECT 1 FROM jsonb_array_elements(COALESCE(NEW.patients_json, '[]'::jsonb))
      WHERE value->>'id' IS DISTINCT FROM v_archive.patient_id
        AND regexp_replace(COALESCE(value->>'dni', ''), '[^0-9]', '', 'g') =
          regexp_replace(v_archive.patient->>'dni', '[^0-9]', '', 'g')
    ) THEN RAISE EXCEPTION 'Este DNI pertenece a un paciente archivado. Consultá Pacientes eliminados antes de crear otra ficha' USING ERRCODE = '22023'; END IF;
    NEW.patients_json := COALESCE((SELECT jsonb_agg(value) FROM jsonb_array_elements(COALESCE(NEW.patients_json, '[]'::jsonb))
      WHERE value->>'id' IS DISTINCT FROM v_archive.patient_id), '[]'::jsonb) || jsonb_build_array(v_archive.patient);
  END LOOP;
  RETURN NEW;
END;
$$;
-- Runs before dental_protect_workspace, so stale saves cannot remove archived identities.
CREATE TRIGGER a_dental_preserve_archived_patients BEFORE INSERT OR UPDATE ON public.user_workspaces
FOR EACH ROW EXECUTE FUNCTION public.dental_preserve_archived_patients();

CREATE FUNCTION public.dental_archive_read_only() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM 1 FROM public.user_workspaces WHERE user_id = NEW.professional_id FOR UPDATE;
  IF EXISTS (SELECT 1 FROM public.dental_patient_archives
    WHERE professional_id = NEW.professional_id AND patient_id = NEW.patient_id AND state <> 'active')
  THEN RAISE EXCEPTION 'Esta ficha está archivada y es de solo lectura. Restaurá al paciente antes de atenderlo' USING ERRCODE = '22023'; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER dental_archive_read_only BEFORE INSERT OR UPDATE ON public.dental_records
FOR EACH ROW EXECUTE FUNCTION public.dental_archive_read_only();

REVOKE ALL ON FUNCTION public.dental_archive_patient(text,text,text), public.dental_preserve_archived_patients(),
  public.dental_archive_read_only() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.dental_archive_patient(text,text,text) TO service_role;
