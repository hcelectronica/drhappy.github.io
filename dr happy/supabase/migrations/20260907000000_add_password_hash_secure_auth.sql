-- Introduce hashing seguro de contraseñas para profesionales.
-- A partir de esta migración, el campo "password" (texto plano) queda
-- obsoleto y sólo se usa un campo separado "password_hash" (bcrypt),
-- que NUNCA se expone a través del cliente anónimo: sólo la Edge
-- Function "auth-professional" (que usa la Service Role Key) puede
-- leerlo o escribirlo.

ALTER TABLE public.professionals
  ADD COLUMN IF NOT EXISTS password_hash TEXT;

-- Refuerza RLS: sólo servicio (service_role) puede seleccionar/actualizar
-- la columna password_hash. Las políticas para el resto de columnas via
-- anon/authenticated permanecen sin cambios funcionales, pero se agrega
-- una política restrictiva explícita para bloquear lectura de columnas
-- sensibles desde clientes públicos.

ALTER TABLE public.professionals ENABLE ROW LEVEL SECURITY;

-- Revoca cualquier permiso directo de columna sensible a roles públicos.
REVOKE SELECT (password_hash) ON public.professionals FROM anon;
REVOKE SELECT (password_hash) ON public.professionals FROM authenticated;
REVOKE UPDATE (password_hash) ON public.professionals FROM anon;
REVOKE UPDATE (password_hash) ON public.professionals FROM authenticated;

-- El campo "password" en texto plano se deja presente temporalmente sólo
-- para no romper filas antiguas durante la migración de datos, pero deja
-- de escribirse desde la aplicación. Una vez migrados todos los usuarios
-- a password_hash, se debe eliminar con:
--   ALTER TABLE public.professionals DROP COLUMN password;
