-- La migración anterior revocó SELECT/UPDATE de la columna password_hash
-- para anon/authenticated, pero eso rompe cualquier "select('*')" desde el
-- cliente (Postgres exige privilegio SELECT en TODAS las columnas
-- referenciadas, incluso con *). Esta migración otorga explícitamente
-- SELECT sobre el resto de columnas (todas menos password_hash) para que
-- select('*') siga funcionando sin exponer nunca el hash de contraseña.

DO $$
DECLARE
  col text;
  cols text[] := ARRAY[]::text[];
BEGIN
  FOR col IN
    SELECT column_name FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'professionals'
      AND column_name NOT IN ('password_hash', 'password')
  LOOP
    cols := array_append(cols, col);
  END LOOP;

  IF array_length(cols, 1) > 0 THEN
    EXECUTE format(
      'GRANT SELECT (%s) ON public.professionals TO anon, authenticated',
      array_to_string(cols, ', ')
    );
    EXECUTE format(
      'GRANT UPDATE (%s) ON public.professionals TO anon, authenticated',
      array_to_string(cols, ', ')
    );
  END IF;
END $$;

-- password (texto plano legado) tampoco debe ser legible/editable desde el
-- cliente a partir de ahora: sólo la Edge Function con service_role la usa
-- (y en la práctica ya no la usa para nada nuevo).
REVOKE SELECT (password) ON public.professionals FROM anon;
REVOKE SELECT (password) ON public.professionals FROM authenticated;
REVOKE UPDATE (password) ON public.professionals FROM anon;
REVOKE UPDATE (password) ON public.professionals FROM authenticated;
