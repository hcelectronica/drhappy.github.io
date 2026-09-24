-- Evita usuarios duplicados aunque cambien mayúsculas, minúsculas o espacios
-- exteriores. La Edge Function normaliza las altas nuevas a minúsculas, mientras
-- este índice también protege los registros históricos y las altas simultáneas.

CREATE UNIQUE INDEX IF NOT EXISTS professionals_username_case_insensitive_unique
  ON public.professionals ((lower(btrim(username))));
