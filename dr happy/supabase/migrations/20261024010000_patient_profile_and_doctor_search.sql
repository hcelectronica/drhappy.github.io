BEGIN;

ALTER TABLE public.patient_accounts
  ADD COLUMN health_insurance text CHECK (char_length(health_insurance) <= 120),
  ADD COLUMN insurance_member_number text CHECK (char_length(insurance_member_number) <= 80);

CREATE FUNCTION public.search_patient_professionals(p_query text)
RETURNS TABLE (id text, full_name text, specialty text)
LANGUAGE sql STABLE
SET search_path = public, pg_temp
AS $$
  WITH query AS (
    SELECT btrim(regexp_replace(
      translate(lower(left(p_query, 120)), 'áéíóúüñ', 'aeiouun'),
      '[^a-z0-9]+', ' ', 'g')) AS value
  )
  SELECT p.id, p.full_name, p.specialty
  FROM public.professionals p CROSS JOIN query q
  WHERE p.active IS TRUE AND char_length(q.value) >= 2
    AND NOT EXISTS (
      SELECT 1 FROM regexp_split_to_table(q.value, '\s+') term
      WHERE strpos(translate(lower(p.full_name), 'áéíóúüñ', 'aeiouun'), term) = 0
    )
  ORDER BY lower(p.full_name), p.id
  LIMIT 11;
$$;
REVOKE ALL ON FUNCTION public.search_patient_professionals(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.search_patient_professionals(text) TO service_role;

COMMIT;
