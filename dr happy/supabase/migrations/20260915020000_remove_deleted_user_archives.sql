-- Las eliminaciones ya no se conservan en la base de datos.
-- El archivo legal se genera en memoria y se envía solo al usuario eliminado.
DELETE FROM public.deleted_user_archives;

DROP POLICY IF EXISTS "archivo legal acceso app" ON public.deleted_user_archives;
DROP POLICY IF EXISTS "sin acceso público a archivo legal" ON public.deleted_user_archives;
DROP POLICY IF EXISTS "deleted user archives read write" ON public.deleted_user_archives;

REVOKE ALL ON public.deleted_user_archives FROM anon, authenticated;
