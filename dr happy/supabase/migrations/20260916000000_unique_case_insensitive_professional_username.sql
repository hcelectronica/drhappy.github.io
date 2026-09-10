-- Evita usuarios duplicados aunque cambien mayúsculas, minúsculas o espacios
-- exteriores. La Edge Function normaliza las altas nuevas a minúsculas, mientras
-- este índice también protege los registros históricos y las altas simultáneas.

CREATE UNIQUE INDEX IF NOT EXISTS professionals_username_case_insensitive_unique
  ON public.professionals ((lower(btrim(username))));

-- Catálogo aprendido de especialidades. Conserva la primera escritura original,
-- pero unifica variantes que solo cambian mayúsculas, tildes o espacios.
CREATE TABLE IF NOT EXISTS public.medical_specialties (
  normalized_name text PRIMARY KEY,
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.medical_specialties ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.medical_specialties FROM anon, authenticated;
GRANT SELECT (normalized_name, name, created_at)
  ON public.medical_specialties TO anon, authenticated;

DROP POLICY IF EXISTS "medical_specialties lectura app" ON public.medical_specialties;
CREATE POLICY "medical_specialties lectura app"
  ON public.medical_specialties
  FOR SELECT
  TO anon, authenticated
  USING (true);

CREATE OR REPLACE FUNCTION public.remember_professional_specialty()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  clean_name text;
  normalized text;
BEGIN
  clean_name := btrim(NEW.specialty);
  IF clean_name = '' THEN
    RETURN NEW;
  END IF;

  normalized := translate(
    lower(regexp_replace(clean_name, '\s+', ' ', 'g')),
    'áéíóúüñ',
    'aeiouun'
  );

  INSERT INTO public.medical_specialties (normalized_name, name)
  VALUES (normalized, clean_name)
  ON CONFLICT (normalized_name) DO NOTHING;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.remember_professional_specialty() FROM PUBLIC;

DROP TRIGGER IF EXISTS remember_professional_specialty_trigger ON public.professionals;
CREATE TRIGGER remember_professional_specialty_trigger
  AFTER INSERT OR UPDATE OF specialty ON public.professionals
  FOR EACH ROW
  EXECUTE FUNCTION public.remember_professional_specialty();

INSERT INTO public.medical_specialties (normalized_name, name)
SELECT DISTINCT ON (
  translate(lower(regexp_replace(btrim(specialty), '\s+', ' ', 'g')), 'áéíóúüñ', 'aeiouun')
)
  translate(lower(regexp_replace(btrim(specialty), '\s+', ' ', 'g')), 'áéíóúüñ', 'aeiouun'),
  btrim(specialty)
FROM public.professionals
WHERE btrim(coalesce(specialty, '')) <> ''
ORDER BY
  translate(lower(regexp_replace(btrim(specialty), '\s+', ' ', 'g')), 'áéíóúüñ', 'aeiouun'),
  created_at
ON CONFLICT (normalized_name) DO NOTHING;
