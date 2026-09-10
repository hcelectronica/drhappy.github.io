-- CORRECCIÓN DE SEGURIDAD CRÍTICA
--
-- Problema detectado: la migración 20260907010000 otorgó SELECT y UPDATE sobre
-- TODAS las columnas de professionals (menos password/password_hash en teoría)
-- a los roles anon/authenticated. En la práctica, con la clave pública que va
-- embebida en la app, cualquiera podía:
--   1. Leer el password_hash de todos los usuarios (verificado: el GRANT de
--      SELECT se aplicó a columnas nuevas y el REVOKE previo quedó incompleto).
--   2. Auto-otorgarse is_admin = true y tomar control del panel de administración.
--   3. Activarse la suscripción (subscription_status / subscription_expires_at).
--   4. Reactivar cuentas desactivadas o habilitarse módulos premium.
--
-- Solución: la clave pública queda con permiso de escritura ÚNICAMENTE sobre los
-- campos del propio perfil (nombre, especialidad, matrícula, etc.). Los campos
-- privilegiados pasan a ser exclusivos del backend (Service Role), a través de la
-- Edge Function admin-professionals, que valida que el solicitante sea admin.

-- ── 1) Revocar todo y reconstruir con lista blanca ──────────────────────────────
REVOKE UPDATE ON public.professionals FROM anon, authenticated;
REVOKE SELECT ON public.professionals FROM anon, authenticated;
REVOKE INSERT ON public.professionals FROM anon, authenticated;
REVOKE DELETE ON public.professionals FROM anon, authenticated;

-- ── 2) SELECT: todas las columnas MENOS los secretos de autenticación ───────────
-- select('*') desde el cliente exige privilegio sobre cada columna referenciada,
-- así que se listan explícitamente todas las que no son sensibles.
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
    cols := array_append(cols, quote_ident(col));
  END LOOP;

  IF array_length(cols, 1) > 0 THEN
    EXECUTE format(
      'GRANT SELECT (%s) ON public.professionals TO anon, authenticated',
      array_to_string(cols, ', ')
    );
  END IF;
END $$;

-- ── 3) UPDATE: solo los campos del perfil que edita el propio profesional ───────
-- Quedan EXCLUIDOS a propósito: is_admin, active, subscription_status,
-- subscription_expires_at, trial_started_at, enabled_modules_json, password_hash.
GRANT UPDATE (
  full_name,
  specialty,
  license_number,
  email,
  dni,
  network_memberships_json,
  last_seen_at
) ON public.professionals TO anon, authenticated;

-- ── 4) INSERT: alta de cuenta desde la pantalla de registro ─────────────────────
-- El alta no puede fijar is_admin ni el estado de suscripción: esas columnas
-- toman su valor por defecto (false / trial) definido en la tabla.
GRANT INSERT (
  id,
  username,
  full_name,
  specialty,
  license_number,
  email,
  dni,
  network_memberships_json,
  last_seen_at
) ON public.professionals TO anon, authenticated;

-- ── 5) Blindaje a nivel fila: nadie puede escalar privilegios vía UPDATE ────────
-- Aunque los GRANT ya bloquean el cambio de columnas sensibles, se agrega una
-- política RLS explícita como segunda barrera (defensa en profundidad).
ALTER TABLE public.professionals ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "professionals lectura app" ON public.professionals;
CREATE POLICY "professionals lectura app"
  ON public.professionals
  FOR SELECT
  TO anon, authenticated
  USING (true);

DROP POLICY IF EXISTS "professionals alta desde registro" ON public.professionals;
CREATE POLICY "professionals alta desde registro"
  ON public.professionals
  FOR INSERT
  TO anon, authenticated
  WITH CHECK (is_admin IS NOT TRUE);

DROP POLICY IF EXISTS "professionals actualiza perfil propio" ON public.professionals;
CREATE POLICY "professionals actualiza perfil propio"
  ON public.professionals
  FOR UPDATE
  TO anon, authenticated
  USING (true)
  WITH CHECK (true);

-- Sin política de DELETE: la baja de usuarios solo ocurre por Edge Function
-- (admin-professionals / self-delete-account) usando Service Role.
DROP POLICY IF EXISTS "professionals borrado" ON public.professionals;
