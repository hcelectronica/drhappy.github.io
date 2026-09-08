-- Agrega columna de último acceso del profesional para métricas de uso
-- del panel de administración (sin exponer datos clínicos).
ALTER TABLE public.professionals
  ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMPTZ;

-- La columna debe ser actualizable por el propio usuario al iniciar sesión.
-- Ya tiene UPDATE sobre la tabla por las migraciones anteriores de grants,
-- pero nos aseguramos explícitamente de que la columna nueva quede incluida.
DO $$
BEGIN
  -- Grant de UPDATE sobre la columna nueva a los roles que ya tienen acceso a la tabla.
  -- (El GRANT a nivel tabla ya cubre columnas nuevas en Postgres, pero lo dejamos explícito.)
  EXECUTE 'GRANT UPDATE (last_seen_at) ON public.professionals TO authenticated';
  EXECUTE 'GRANT UPDATE (last_seen_at) ON public.professionals TO anon';
EXCEPTION WHEN OTHERS THEN
  -- Si los roles no existen o ya tienen el grant, no fallamos la migración.
  NULL;
END $$;
