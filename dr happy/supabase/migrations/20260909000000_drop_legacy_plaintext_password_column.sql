-- Elimina la columna legacy `password` (texto plano) de la tabla professionals.
-- Desde la migración 20260907000000 toda la autenticación pasa por la columna
-- `password_hash` (bcrypt) gestionada únicamente por la Edge Function
-- auth-professional con la Service Role Key. La app ya no lee ni escribe la
-- columna `password`, pero la restricción NOT NULL heredada rompía el upsert
-- de sincronización del perfil (loadWorkspaceForUser) al hacer login:
--   "null value in column "password" of relation "professionals" violates
--    not-null constraint"
-- Quitar la columna corrige ese error y además elimina definitivamente
-- cualquier resto de contraseñas en texto plano en la base de datos.

ALTER TABLE public.professionals DROP COLUMN IF EXISTS password;
