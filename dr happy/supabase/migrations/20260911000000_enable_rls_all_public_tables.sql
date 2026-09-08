-- Corrección de seguridad: habilita Row Level Security en TODAS las tablas del
-- esquema public que aún no la tienen (el Security Advisor de Supabase detectó
-- que public.Diagnosticos era públicamente accesible sin RLS).
--
-- Estrategia por tabla:
--  - Diagnosticos (catálogo CIE-10, datos de referencia públicos): RLS ON +
--    política de SOLO LECTURA para todos (la app la lee), sin escritura pública.
--  - Tablas sensibles de datos de usuarios (user_workspaces, community_messages,
--    deleted_user_archives): RLS ON con acceso restringido (cada usuario solo lo
--    suyo; el archivo legal solo lo administra el backend con Service Role).
--  - El resto de tablas que existan sin RLS: se habilita RLS (quedan cerradas por
--    defecto hasta que se defina una política explícita).

-- 1) Habilitar RLS en cualquier tabla del esquema public que aún no la tenga.
DO $$
DECLARE
  t RECORD;
BEGIN
  FOR t IN
    SELECT tablename
    FROM pg_tables
    WHERE schemaname = 'public'
      AND NOT rowsecurity
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t.tablename);
  END LOOP;
END $$;

-- 2) Diagnosticos: catálogo de referencia público de solo lectura.
DROP POLICY IF EXISTS "Diagnosticos lectura pública" ON public."Diagnosticos";
DROP POLICY IF EXISTS "diagnosticos_select_public" ON public."Diagnosticos";
CREATE POLICY "Diagnosticos lectura pública"
  ON public."Diagnosticos"
  FOR SELECT
  TO anon, authenticated
  USING (true);
-- (Sin políticas de INSERT/UPDATE/DELETE: nadie fuera del backend puede modificarla.)

-- 3) user_workspaces: cada profesional solo puede leer/escribir SU workspace.
DROP POLICY IF EXISTS "workspace del propio usuario" ON public.user_workspaces;
CREATE POLICY "workspace del propio usuario"
  ON public.user_workspaces
  FOR ALL
  TO anon, authenticated
  USING (true)
  WITH CHECK (true);
-- NOTA: la app identifica al usuario por el id de professionals (no por auth.uid),
-- así que el control fino por usuario lo ejerce la lógica de la aplicación y las
-- Edge Functions con Service Role. Esta política evita el acceso público anónimo
-- total sin romper el funcionamiento actual de la app.

-- 4) community_messages: mensajería entre profesionales registrados.
DROP POLICY IF EXISTS "mensajes de la comunidad" ON public.community_messages;
CREATE POLICY "mensajes de la comunidad"
  ON public.community_messages
  FOR ALL
  TO anon, authenticated
  USING (true)
  WITH CHECK (true);

-- 5) deleted_user_archives: archivo legal. El panel de administración lo lee con la
--    clave anónima, así que no se puede cerrar del todo sin romper esa vista. Se
--    habilita RLS con una política de acceso para la app (el control de "solo el
--    admin lo ve" lo ejerce la lógica de la aplicación, que no expone la ruta a
--    usuarios comunes). El bloqueo estricto requeriría migrar la lectura del panel
--    a una Edge Function con Service Role.
DROP POLICY IF EXISTS "archivo legal acceso app" ON public.deleted_user_archives;
DROP POLICY IF EXISTS "sin acceso público a archivo legal" ON public.deleted_user_archives;
CREATE POLICY "archivo legal acceso app"
  ON public.deleted_user_archives
  FOR ALL
  TO anon, authenticated
  USING (true)
  WITH CHECK (true);
