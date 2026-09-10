-- Garantiza una sola cuenta por email sin distinguir mayúsculas, minúsculas
-- ni espacios exteriores, incluso ante altas simultáneas.

CREATE UNIQUE INDEX IF NOT EXISTS professionals_email_case_insensitive_unique
  ON public.professionals ((lower(btrim(email))));
